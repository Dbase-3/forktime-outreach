"use strict";

const { voice, llm, inference } = require("@livekit/agents");
const { ParticipantKind } = require("@livekit/rtc-node");
const { BackgroundVoiceCancellation, TelephonyBackgroundVoiceCancellation } = require("@livekit/noise-cancellation-node");
const anthropic = require("@livekit/agents-plugin-anthropic");
const elevenlabs = require("@livekit/agents-plugin-elevenlabs");
const soniox = require("@livekit/agents-plugin-soniox");
const { z } = require("zod");
const { nextStep, answerFormat, lookahead, askedInReply } = require("@outreach/core/workflow-run");
const { callInstructions, noteValue, BOOK_NOW } = require("@outreach/core/call-instructions");
const { ACTION_LABELS } = require("@outreach/core/action-labels");
const { integrationName, needsConnection } = require("@outreach/core/connections");
const { isLiveBooking, hasLiveBookingStep } = require("@outreach/core/calendar");

const { VOICE, TIMING, VOICE_IDS, LANGUAGE_CODES, env, ttsOptions } = require("./config");
const { wrapUp } = require("./wrapup");
const { asksForPhoneNumber, isIncompletePhoneReply } = require("./phone-input");

/** The model's side of the call: a caller turn that's only part of a phone number waits for the rest. */
class PlatformAgent extends voice.Agent {
  constructor(call, options) {
    super(options);
    this.call = call;
  }
  async onUserTurnCompleted(_chatCtx, newMessage) {
    if (!this.call.acceptCallerTurn(newMessage)) throw new voice.StopResponse();
  }
  /** Keeps what the model says in each reply, so `note` knows whether the next line was already said in it. */
  async llmNode(chatCtx, toolCtx, modelSettings) {
    const stream = await voice.Agent.default.llmNode(this, chatCtx, toolCtx, modelSettings);
    const call = this.call;
    call.replyText = "";
    if (!stream) return stream;
    return stream.pipeThrough(
      new TransformStream({
        transform(chunk, out) {
          const text = typeof chunk === "string" ? chunk : chunk && chunk.delta && chunk.delta.content;
          if (text) call.replyText += text;
          out.enqueue(chunk);
        },
      }),
    );
  }
}

// One call with an agent the owner built: say the welcome, then let the model
// talk while the workflow runs in code. The model notes answers; `nextStep`
// (packages/core) decides what comes next; actions and the ending run here.

const Events = voice.AgentSessionEventTypes;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const NUDGES = {
  stillThere: "Nobody has spoken for a while. Ask once, in a few words, whether they are still there.",
  timeLimit: "You are out of time. Say a one-sentence goodbye and call end_call.",
};

/** What the call does for an action step, and what the model is told. Test calls never reach the outside world. */
function runAction(step, detail, test, connected = []) {
  const what = detail ? `${ACTION_LABELS[step.action]}: ${detail}` : ACTION_LABELS[step.action];
  const tag = { book: "booked", transfer: "transferred", text: "texted", crm: "crm", webhook: "webhook" }[step.action];
  // It needs an integration the workspace hasn't connected: skip it, say so, carry on.
  if (needsConnection(step.integration) && !connected.includes(step.integration)) {
    const name = integrationName(step.integration);
    return { line: `${what} (skipped, ${name} isn't connected)`, tag: null, tell: `That step couldn't run (${name} isn't connected). Don't mention it; carry on.` };
  }
  if (test) return { line: `${what} (test call, nothing was really done)`, tag, tell: `Done: ${what}. Tell them it's done, in a few words.` };
  // Real integrations arrive in Phase 6; until then the team follows up.
  return { line: `${what} (for the team to do)`, tag, tell: `Noted for the team: ${what}. Tell them the team will confirm it shortly.` };
}

class PlatformCall {
  constructor({ ctx, api, cfg, vad, log = console }) {
    this.ctx = ctx;
    this.api = api;
    this.cfg = cfg;
    this.vad = vad;
    this.log = log;
    this.values = { ...cfg.values };
    this.saved = {};
    this.done = new Set();
    this.position = nextStep(cfg.flow.steps, this.values, this.done);
    this.fields = new Map(cfg.schema.map((f) => [f.key, { ...f, choices: cfg.choices[f.key] }]));
    this.pending = null;
    this.filed = null;
    this.ended = false;
    this.silences = 0;
    this.userState = "listening";
    this.agentState = "initializing";
    this.agentSpokeLast = false;
    this.startedAt = null;
    this.timers = new Set();
    this.lines = [];
    this.awaitingPhone = false;
    this.phoneFragments = [];
    this.ahead = null;
    this.replyText = "";
  }

  after(ms, fn) {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    this.timers.add(t);
  }

  instructions() {
    // The next line for each answer, so the model can say it with the note: one model round, not two.
    this.ahead = lookahead(this.cfg.flow.steps, this.values, this.done, this.position);
    return callInstructions(this.cfg, this.position, this.ahead);
  }

  /** The person is in the room: start listening and say the welcome. */
  async start(participant) {
    this.participant = participant;
    this.ctx.room.on("participantDisconnected", (p) => {
      if (p.identity === participant.identity) this.finalize("caller_hung_up");
    });
    this.api.report({ type: "answered" });
    this.api.report({ type: "step", path: this.position.path });
    await this.startSession(participant);
    this.after(TIMING.greetingDelayMs, () => {
      this.startedAt = Date.now();
      this.session.say(this.cfg.greeting, { allowInterruptions: true, addToChatCtx: true });
    });
    this.after(this.cfg.maxCallMinutes * 60_000, () => this.onTimeLimit());
  }

  async startSession(participant) {
    const { cfg } = this;
    const language = LANGUAGE_CODES[cfg.voice.language] || "en";
    this.llm = new anthropic.LLM({ ...VOICE.llm, apiKey: env.anthropicKey() });
    // Turn detection as on the outreach agent: LiveKit's audio model, with its smaller one as the fallback.
    const detector = env.turnDetector();
    let turnDetection = "stt";
    if (detector === "audio") {
      try {
        turnDetection = new inference.TurnDetector({ version: "v1" });
      } catch (err) {
        this.log.warn(`[Call] audio turn detector unavailable: ${err.message}`);
        turnDetection = new inference.TurnDetector({ version: "v1-mini" });
      }
    } else if (detector === "multilingual") {
      turnDetection = new (require("@livekit/agents-plugin-livekit").turnDetector.MultilingualModel)(0.15);
    }
    this.session = new voice.AgentSession({
      vad: this.vad,
      stt: new soniox.STT({
        ...VOICE.stt,
        languageHints: [language],
        apiKey: process.env.SONIOX_API_KEY,
        context: { general: [{ key: "domain", value: `A phone call with ${cfg.business}` }], terms: [cfg.business, cfg.voice.name, "AI assistant"].filter(Boolean) },
      }),
      tts: new elevenlabs.TTS({ ...ttsOptions(cfg.voice.speed), voiceId: VOICE_IDS[cfg.voice.voiceId] || VOICE_IDS.v_ava, apiKey: process.env.ELEVENLABS_API_KEY }),
      llm: this.llm,
      turnHandling: { turnDetection, endpointing: VOICE.endpointing, interruption: VOICE.interruption },
      maxToolSteps: VOICE.session.maxToolSteps,
      transcriptionTimeout: VOICE.session.transcriptionTimeout,
      userAwayTimeout: VOICE.session.userAwayTimeoutSec,
      connOptions: { llmConnOptions: { maxRetry: 1, timeoutMs: VOICE.session.llmTimeoutMs }, maxUnrecoverableErrors: 50 },
      ttsTextTransforms: ["filter_markdown", "filter_emoji"],
    });

    this.session.on(Events.ConversationItemAdded, (e) => this.onItem(e.item));
    this.session.on(Events.UserStateChanged, (e) => {
      this.userState = e.newState;
      if (e.newState === "speaking") this.silences = 0;
      if (e.newState === "away") this.onSilence();
    });
    this.session.on(Events.AgentStateChanged, (e) => (this.agentState = e.newState));
    this.session.on(Events.FunctionToolsExecuted, () => this.runPending());
    // Where each turn's time goes (PLATFORM_METRICS=1): end of their words → transcript → model → voice.
    if (process.env.PLATFORM_METRICS) {
      this.session.on(Events.MetricsCollected, ({ metrics: m }) => {
        if (m.type === "eou_metrics") this.log.log(`[Metrics] turn end ${Math.round(m.endOfUtteranceDelayMs)} ms, transcript ${Math.round(m.transcriptionDelayMs)} ms`);
        else if (m.type === "llm_metrics") this.log.log(`[Metrics] model first word ${Math.round(m.ttftMs)} ms, whole ${Math.round(m.durationMs)} ms, prompt ${m.promptTokens} (cached ${m.promptCachedTokens})`);
        else if (m.type === "tts_metrics") this.log.log(`[Metrics] voice first audio ${Math.round(m.ttfbMs)} ms`);
      });
    }
    this.session.on(Events.Error, (e) => this.log.warn(`[Call] session error: ${e.error && e.error.message}`));
    this.session.on(Events.Close, (e) => this.finalize(e.error ? "failed" : "agent_ended"));

    this.agent = new PlatformAgent(this, { instructions: this.instructions(), tools: this.tools() });
    // Background voices and noise removed from the caller's audio: the phone model for phone calls (as on outreach), the general one for browsers.
    const noiseCancellation = participant.kind === ParticipantKind.SIP ? TelephonyBackgroundVoiceCancellation() : BackgroundVoiceCancellation();
    await this.session.start({
      agent: this.agent,
      room: this.ctx.room,
      inputOptions: { audioSampleRate: 16000, audioNumChannels: 1, noiseCancellation, participantIdentity: participant.identity, closeOnDisconnect: false },
      // Captions go out as soon as the words are known: waiting to sync them with
      // ElevenLabs' timings left playout unfinished (the outreach agent does the same).
      outputOptions: { audioSampleRate: 16000, audioNumChannels: 1, syncTranscription: false },
    });
  }

  secondsIn() {
    return this.startedAt ? Math.max(0, (Date.now() - this.startedAt) / 1000) : 0;
  }

  onItem(item) {
    const who = item && item.role === "assistant" ? "agent" : item && item.role === "user" ? "caller" : null;
    const text = item && typeof item.textContent === "string" ? item.textContent.trim() : "";
    if (!who || !text) return;
    this.agentSpokeLast = who === "agent";
    if (who === "agent" && asksForPhoneNumber(text)) this.setAwaitingPhone(true);
    this.lines.push({ who, text });
    this.api.report({ type: "line", line: { who, text: text.slice(0, 4000), at: Math.round(this.secondsIn()) } });
  }

  setAwaitingPhone(enabled) {
    if (this.awaitingPhone === enabled || !this.session) return;
    this.awaitingPhone = enabled;
    this.session.updateOptions({ turnHandling: { endpointing: enabled ? VOICE.phoneEndpointing : VOICE.endpointing } });
  }

  /** Keep listening if a pause split a phone number into separate turns (from the outreach agent). */
  acceptCallerTurn(message) {
    if (!this.awaitingPhone) return true;
    const text = message.textContent.trim();
    const pause = text.match(/\b(?:wait (?:a |one )?(?:second|sec|moment)|give me (?:a |one )?(?:second|sec|moment)|hold on)\b/i);
    const answer = pause ? text.replace(pause[0], "").trim() : text;
    if (pause && !/\d|\b(?:zero|oh|one|two|three|four|five|six|seven|eight|nine)\b/i.test(answer)) {
      this.onItem({ role: "user", textContent: text });
      return false;
    }
    const combined = [...this.phoneFragments, answer].join(" ").trim();
    if (isIncompletePhoneReply(combined)) {
      if (answer) this.phoneFragments.push(answer);
      return false;
    }
    if (this.phoneFragments.length) message.content = [combined];
    this.phoneFragments = [];
    this.setAwaitingPhone(false);
    return true;
  }

  tools() {
    const { cfg } = this;
    const keys = [...this.fields.keys()];
    const tools = {
      end_call: llm.tool({
        description:
          "End the call when it can't go on: they want to stop, have no time, ask not to be called again, it's a wrong number, or it's voicemail. " +
          "Not for the workflow's own ending, which the system runs. Your goodbye is spoken for you from `goodbye`: the reply that calls end_call has no words of its own, or the goodbye is said twice.",
        parameters: z.object({
          goodbye: z.string().describe("Your last words: one short, warm sentence."),
          outcome: z.enum(cfg.outcomes).describe("How the call ended."),
          summary: z.string().describe("Two short factual sentences: who you spoke to and what happened."),
        }),
        execute: async ({ goodbye, outcome, summary }) => {
          this.filed = { outcome, summary };
          this.pending = { type: "end", goodbye };
          return undefined;
        },
      }),
    };
    if (keys.length) {
      tools.note = llm.tool({
        description:
          "Save something they actually said: the answer to the current question, a later question answered early, a changed answer, or something to listen for. Never save a question you are asking. " +
          "The result says what to say next, unless you've already said it (see Right now).",
        parameters: z.object({
          field: z.enum(keys).describe("Which field."),
          value: z.string().describe("Their answer, in the field's format."),
        }),
        execute: async ({ field, value }) => this.note(field, value),
      });
    }
    if (cfg.calendar) Object.assign(tools, this.calendarTools());
    if (cfg.knowledge.searchable) {
      tools.search_knowledge = llm.tool({
        description: "Look up facts about the business (hours, prices, policies, services) before answering a question about them.",
        parameters: z.object({ question: z.string().describe("What they asked, as a short search.") }),
        execute: async ({ question }) => {
          try {
            const { passages } = await this.api.search(question);
            if (!passages.length) return "Nothing about that in the documents. Say the team will follow up.";
            return passages.map((p) => `[${p.docName}${p.heading ? ` · ${p.heading}` : ""}] ${p.text}`).join("\n\n");
          } catch (err) {
            this.log.warn(`[Call] search failed: ${err.message}`);
            return "The documents can't be searched right now. Say the team will follow up.";
          }
        },
      });
    }
    return tools;
  }

  /** A Book step on the calendar this call books into: it waits for the caller to pick a time. */
  isBookingStep(step) {
    return Boolean(this.cfg.calendar && isLiveBooking(step, this.cfg.calendar.provider));
  }

  /** A CRM step on a connected CRM (GoHighLevel, Twenty): it really saves, test calls included. */
  isCrmStep(step) {
    return step.kind === "action" && step.action === "crm" && Boolean(step.integration) && (this.cfg.crms || []).includes(step.integration);
  }

  /** Save in the background (the call doesn't wait); the transcript gets what happened. */
  runCrmStep(step, detail) {
    const name = integrationName(step.integration);
    Promise.resolve(this.api.saveToCrm(step.integration, { ...this.saved }))
      .then((r) => this.api.report({ type: "line", line: { who: "action", text: `${detail ? `${detail}: ` : ""}${(r && r.text) || `saved to ${name}`}`, at: Math.round(this.secondsIn()) } }))
      .catch((err) => {
        this.log.warn(`[Call] CRM save failed: ${err.message}`);
        this.api.report({ type: "line", line: { who: "action", text: `${name}: couldn't save (${err.message.slice(0, 120)})`, at: Math.round(this.secondsIn()) } });
      });
    return { line: null, tag: "crm", tell: `Saved to ${name}. Don't mention it; carry on.` };
  }

  /** The workflow is waiting at a Book step: it's done (booked or declined), so carry on. */
  finishBookingStep(prefix) {
    const { next } = this.position;
    if (next.kind !== "action" || !this.isBookingStep(next.step)) return null;
    for (const s of this.position.say) this.done.add(s.id);
    this.done.add(next.step.id);
    return this.advance(prefix);
  }

  calendarTools() {
    const { cfg } = this;
    const name = cfg.calendar.name;
    const tools = {
      check_times: llm.tool({
        description: `Get free times from ${name}, from today or from a day they asked about. Say a few words first (like "Let me check what's free").`,
        parameters: z.object({ from: z.string().optional().describe("A day to start from, YYYY-MM-DD, when they asked about a particular day. Leave out for the next free times.") }),
        execute: async ({ from }) => {
          try {
            const { text } = await this.api.freeTimes(/^\d{4}-\d{2}-\d{2}$/.test(from || "") ? from : undefined);
            return `${text}\nOffer two or three of these in plain words (never read out the values in brackets).`;
          } catch (err) {
            this.log.warn(`[Call] check_times failed: ${err.message}`);
            return "The calendar can't be checked right now. Say the team will confirm a time with them.";
          }
        },
      }),
      book_time: llm.tool({
        description: `Book the time they picked in ${name}. Only after they've agreed to a day and time from check_times.`,
        parameters: z.object({
          start: z.string().describe("The exact value in brackets after the time they picked, from check_times."),
          name: z.string().describe("The name to book under: the person's full name as they gave it."),
          email: z.string().optional().describe("Their email, only if they gave one or the calendar asked for it."),
        }),
        execute: async ({ start, name: who, email }) => {
          let res;
          try {
            res = await this.api.book({ start, name: who, ...(email ? { email } : {}) });
          } catch (err) {
            this.log.warn(`[Call] book_time failed: ${err.message}`);
            res = { ok: false, text: "The calendar didn't answer. Say the team will confirm the time with them." };
          }
          if (!res.ok) return res.text;
          this.api.report({ type: "line", line: { who: "action", text: `Booked in ${name}: ${res.when}${cfg.test ? " (test call, really booked)" : ""}`, at: Math.round(this.secondsIn()) } });
          this.api.report({ type: "action", action: "booked" });
          const then = this.finishBookingStep(`Booked: ${res.when}.`);
          if (then === undefined) return undefined; // the workflow ends: its closing line is spoken for you
          return then || `Booked: ${res.when}. Tell them it's booked, in a few words, then carry on.`;
        },
      }),
    };
    const changeLine = (text) => this.api.report({ type: "line", line: { who: "action", text: `${text}${cfg.test ? " (test call, really changed)" : ""}`, at: Math.round(this.secondsIn()) } });
    tools.find_booking = llm.tool({
      description: `Look up the caller's upcoming bookings in ${name}, when they want to check, move or cancel one. Say a few words first.`,
      parameters: z.object({ email: z.string().optional().describe("The email they booked with, only if the result asked for it.") }),
      execute: async ({ email }) => {
        try {
          return (await this.api.myBookings(email)).text;
        } catch (err) {
          this.log.warn(`[Call] find_booking failed: ${err.message}`);
          return "The calendar can't be checked right now. Say the team will help with their booking.";
        }
      },
    });
    tools.move_booking = llm.tool({
      description: "Move one of their bookings (from find_booking) to a free time (from check_times), after they've agreed to the new day and time.",
      parameters: z.object({ id: z.string().describe("The booking's value in brackets, from find_booking."), start: z.string().describe("The new time's value in brackets, from check_times.") }),
      execute: async ({ id, start }) => {
        const res = await this.api.changeBooking({ change: "move", id, start }).catch((err) => ({ ok: false, text: `The calendar didn't answer (${err.message.slice(0, 80)}). Say the team will sort it out.` }));
        if (res.ok) changeLine(`Moved in ${name} to ${res.when}`);
        return res.ok ? `${res.text} Tell them, in a few words.` : res.text;
      },
    });
    tools.cancel_booking = llm.tool({
      description: "Cancel one of their bookings (from find_booking), only after they've clearly said to cancel it and you've repeated which one.",
      parameters: z.object({ id: z.string().describe("The booking's value in brackets, from find_booking."), reason: z.string().describe("Why, in a few words, if they said.") }),
      execute: async ({ id, reason }) => {
        const res = await this.api.changeBooking({ change: "cancel", id, reason }).catch((err) => ({ ok: false, text: `The calendar didn't answer (${err.message.slice(0, 80)}). Say the team will sort it out.` }));
        if (res.ok) changeLine(`Cancelled a booking in ${name}${reason ? ` (${reason})` : ""}`);
        return res.ok ? `${res.text} Tell them it's cancelled, in a few words.` : res.text;
      },
    });
    if (hasLiveBookingStep(cfg.flow.steps, cfg.calendar.provider)) {
      tools.skip_booking = llm.tool({
        description: "They don't want to book a time now. The workflow then carries on.",
        parameters: z.object({ reason: z.string().describe("Why, in a few words.") }),
        execute: async ({ reason }) => {
          this.api.report({ type: "line", line: { who: "action", text: `No booking: ${reason}`, at: Math.round(this.secondsIn()) } });
          const then = this.finishBookingStep(`Not booked (${reason}).`);
          return then === null ? "Fine. Carry on where you were." : then;
        },
      });
    }
    return tools;
  }

  /** A noted answer: check it, save it, move the workflow on, and tell the model what's next. */
  note(field, value) {
    const def = this.fields.get(field);
    if (!def) return `There's no field "${field}".`;
    const checked = noteValue(def, value);
    if (!checked.ok) return checked.reason;
    this.saved[field] = checked.value;
    this.values[field] = checked.value;
    this.api.report({ type: "saved", field, value: checked.value });
    const isWorkflowField = def.from === "step";
    if (!isWorkflowField) return `Saved ${field}. Carry on where you were.`;
    const ahead = this.ahead;
    const result = this.advance(`Saved ${field} = ${checked.value}.`);
    // The model already asked the next question in this reply (it was shown ahead): nothing more to say,
    // so no second model round. If it only noted, the result tells it what to say, as before.
    const known = ahead && ahead.field === field && ahead.cases.find((c) => c.when === checked.value || c.when === "any answer");
    const oneRound = result !== undefined && known && known.then.kind === "ask" && askedInReply(this.replyText, known.then.question);
    if (process.env.PLATFORM_METRICS) this.log.log(`[Note] ${field}=${checked.value} ${oneRound ? "one round" : result === undefined ? "ending" : "second round"} (said: ${JSON.stringify(this.replyText.slice(0, 80))})`);
    return oneRound ? undefined : result;
  }

  /** Walk the workflow on from here: run actions in code, stop at a question or the ending. */
  advance(prefix) {
    // What the model was last told to say has been said by now.
    for (const s of this.position.say) this.done.add(s.id);
    const parts = [prefix];
    const say = [];
    for (let guard = 0; guard < 50; guard++) {
      this.position = nextStep(this.cfg.flow.steps, this.values, this.done);
      const { next } = this.position;
      say.push(...this.position.say.map((s) => s.text));
      if (next.kind !== "action" || this.isBookingStep(next.step)) break;
      for (const s of this.position.say) this.done.add(s.id);
      this.done.add(next.step.id);
      const result = this.isCrmStep(next.step) ? this.runCrmStep(next.step, next.detail) : runAction(next.step, next.detail, this.cfg.test, this.cfg.connected || []);
      if (result.line) this.api.report({ type: "line", line: { who: "action", text: result.line, at: Math.round(this.secondsIn()) } });
      if (result.tag) this.api.report({ type: "action", action: result.tag });
      parts.push(result.tell);
    }
    this.api.report({ type: "step", path: this.position.path });
    const { next } = this.position;

    if (next.kind === "end") {
      for (const s of this.position.say) this.done.add(s.id);
      this.filed = { outcome: next.step.outcome || "done", summary: null };
      this.pending = { type: "end", goodbye: [...say, next.text].filter(Boolean).join(" ") };
      return undefined; // the ending is spoken by the call, not the model
    }
    Promise.resolve(this.agent.updateInstructions(this.instructions())).catch(() => undefined);
    if (say.length) parts.push(`Say: "${say.join(" ")}"`);
    if (next.kind === "action") parts.push(`Then: ${BOOK_NOW}`);
    else if (next.kind === "ask") parts.push(`Then ask: "${next.question}" Save the answer with note, field "${next.step.field}" (${answerFormat(next.step)}).`);
    else parts.push("The workflow has no more steps. Help with anything else they need, then call end_call.");
    return parts.join(" ");
  }

  /** What a tool asked for runs here, once the agent has finished its sentence. */
  async runPending() {
    const action = this.pending;
    if (!action || action.running || this.ended) return;
    action.running = true;
    await sleep(200);
    for (let waited = 0; this.agentState === "speaking" && waited < 10_000; waited += 100) await sleep(100);
    if (this.ended) return;
    if (action.goodbye) {
      const handle = this.session.say(action.goodbye, { allowInterruptions: true });
      await handle.waitForPlayout().catch(() => undefined);
      if (handle.interrupted) {
        // They spoke over the goodbye: keep talking.
        this.pending = null;
        return;
      }
    }
    await sleep(TIMING.hangupDelayMs);
    return this.finalize("agent_ended");
  }

  async onSilence() {
    if (this.ended || this.pending || this.userState === "speaking") return;
    this.silences += 1;
    if (this.silences >= 2) return this.finalize("agent_ended");
    if (this.awaitingPhone) {
      this.phoneFragments = [];
      return this.session.generateReply({ instructions: "Ask once for the full phone number. Then wait for the answer." });
    }
    this.session.generateReply({ instructions: NUDGES.stillThere });
  }

  onTimeLimit() {
    if (this.ended) return;
    if (this.userState !== "speaking") this.session.generateReply({ instructions: NUDGES.timeLimit });
    this.after(TIMING.timeLimitGraceMs, () => this.finalize("agent_ended"));
  }

  /** Close the call once, whatever ended it: file it, then leave. */
  async finalize(endReason) {
    if (this.ended) return;
    this.ended = true;
    for (const t of this.timers) clearTimeout(t);
    if (this.phoneFragments.length) this.onItem({ role: "user", textContent: this.phoneFragments.join(" ") });
    const lines = this.lines;
    const missingListen = this.cfg.schema.filter((f) => f.from === "listen" && !this.saved[f.key]);
    let filed = this.filed;
    if ((!filed || !filed.summary || missingListen.length) && lines.some((l) => l.who === "caller")) {
      const t = Date.now();
      const wrapped = await wrapUp({ llmModel: this.llm, lines, cfg: this.cfg, fields: missingListen, ChatContext: llm.ChatContext, log: this.log });
      this.log.log(`[Call] wrap-up ${wrapped ? "done" : "gave nothing"} in ${Date.now() - t} ms`);
      if (wrapped) {
        for (const [k, v] of Object.entries(wrapped.data)) {
          const def = this.fields.get(k);
          const checked = def && noteValue(def, v);
          if (checked && checked.ok) this.api.report({ type: "saved", field: k, value: checked.value });
        }
        filed = { outcome: (filed && filed.outcome) || wrapped.outcome || "other", summary: (filed && filed.summary) || wrapped.summary || "" };
      }
    }
    filed = filed || { outcome: lines.some((l) => l.who === "caller") ? "other" : "no_answer", summary: "" };
    await this.api.report({ type: "ended", outcome: filed.outcome, summary: filed.summary || "", endReason, durationSec: this.secondsIn() });
    await this.api.flush();
    if (this.session) await this.session.close().catch(() => undefined);
    if (typeof this.ctx.shutdown === "function") this.ctx.shutdown("call ended");
  }
}

module.exports = { PlatformCall, runAction };
