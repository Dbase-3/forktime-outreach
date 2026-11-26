"use strict";

const { voice, llm } = require("@livekit/agents");
const anthropic = require("@livekit/agents-plugin-anthropic");
const elevenlabs = require("@livekit/agents-plugin-elevenlabs");
const soniox = require("@livekit/agents-plugin-soniox");
const { z } = require("zod");
const { nextStep, answerFormat } = require("@outreach/core/workflow-run");
const { callInstructions, noteValue } = require("@outreach/core/call-instructions");
const { ACTION_LABELS } = require("@outreach/core/action-labels");

const { VOICE, TIMING, VOICE_IDS, LANGUAGE_CODES, env, ttsOptions } = require("./config");
const { wrapUp } = require("./wrapup");

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
function runAction(step, detail, test) {
  const what = detail ? `${ACTION_LABELS[step.action]}: ${detail}` : ACTION_LABELS[step.action];
  const tag = { book: "booked", transfer: "transferred", text: "texted", crm: "crm", webhook: "webhook" }[step.action];
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
  }

  after(ms, fn) {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    this.timers.add(t);
  }

  instructions() {
    return callInstructions(this.cfg, this.position);
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
      turnHandling: { turnDetection: "stt", endpointing: VOICE.endpointing, interruption: VOICE.interruption },
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

    this.agent = new voice.Agent({ instructions: this.instructions(), tools: this.tools() });
    await this.session.start({
      agent: this.agent,
      room: this.ctx.room,
      inputOptions: { audioSampleRate: 16000, audioNumChannels: 1, participantIdentity: participant.identity, closeOnDisconnect: false },
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
    this.lines.push({ who, text });
    this.api.report({ type: "line", line: { who, text: text.slice(0, 4000), at: Math.round(this.secondsIn()) } });
  }

  tools() {
    const { cfg } = this;
    const keys = [...this.fields.keys()];
    const tools = {
      end_call: llm.tool({
        description:
          "End the call when it can't go on: they want to stop, have no time, ask not to be called again, it's a wrong number, or it's voicemail. " +
          "Not for the workflow's own ending, which the system runs. Your goodbye is spoken for you: write nothing else in that reply.",
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
        description: "Save something they said: the answer to the current question, a later question answered early, a changed answer, or something to listen for. Call it before replying; the result says what to say next.",
        parameters: z.object({
          field: z.enum(keys).describe("Which field."),
          value: z.string().describe("Their answer, in the field's format."),
        }),
        execute: async ({ field, value }) => this.note(field, value),
      });
    }
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
    return this.advance(`Saved ${field} = ${checked.value}.`);
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
      if (next.kind !== "action") break;
      for (const s of this.position.say) this.done.add(s.id);
      this.done.add(next.step.id);
      const result = runAction(next.step, next.detail, this.cfg.test);
      this.api.report({ type: "line", line: { who: "action", text: result.line, at: Math.round(this.secondsIn()) } });
      this.api.report({ type: "action", action: result.tag });
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
    if (next.kind === "ask") parts.push(`Then ask: "${next.question}" Save the answer with note, field "${next.step.field}" (${answerFormat(next.step)}).`);
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
