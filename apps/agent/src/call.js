"use strict";

const { voice, llm } = require("@livekit/agents");
const anthropic = require("@livekit/agents-plugin-anthropic");
const elevenlabs = require("@livekit/agents-plugin-elevenlabs");
const soniox = require("@livekit/agents-plugin-soniox");
const { TelephonyBackgroundVoiceCancellation } = require("@livekit/noise-cancellation-node");
const { z } = require("zod");

const { VOICE, TIMING, BOOKING_TERMS, env, ttsOptions } = require("./config");
const { waitForCallAnswer } = require("./callAnswer");
const { createEmitter } = require("./events");
const { classifyLine } = require("./lineCheck");
const { firstName, resolveOpeningLine } = require("./opening");
const { AGENT_OUTCOMES } = require("./outcomes");
const { buildInstructions } = require("./prompt");
const { startRecording, stopRecording } = require("./recording");
const { dialRep, closeRoom, REP_IDENTITY } = require("./transfer");
const { wrapUp } = require("./wrapup");

// One outbound call, start to finish: wait for the pickup, say the opening
// line, let the model talk, connect the owner to the rep when asked, then file
// the call with the app.

const CALLEE_IDENTITY = "callee";

/** What the agent is told when the call itself needs it to act. */
const NUDGES = {
  stillThere: "Nobody has spoken for a while. Ask once, in a few words, whether they are still there.",
  timeLimit: "You are out of time. Say a one-sentence goodbye and end the call.",
};
const Events = voice.AgentSessionEventTypes;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The model's side of the call. Their first words are answered by the opening line, not by the model. */
class OutreachAgent extends voice.Agent {
  constructor(call, options) {
    super(options);
    this.call = call;
  }

  /**
   * Whatever they say before the opening line has finished ("hello? hello?")
   * is answered by that line, not by the model. The SDK drops such a turn, so
   * the call keeps the words itself.
   */
  async onUserTurnCompleted(_chatCtx, newMessage) {
    if (this.call.openingDone) return;
    this.call.onEarlyWords(newMessage && newMessage.textContent);
    throw new voice.StopResponse();
  }
}

class OutreachCall {
  constructor({ ctx, meta, vad, log = console }) {
    this.ctx = ctx;
    this.meta = meta;
    this.vad = vad;
    this.log = log;
    this.rep = firstName(meta.repName);
    this.openingLine = resolveOpeningLine(meta);
    this.lines = [];
    this.openingSaid = false;
    this.userState = "listening";
    this.agentState = "initializing";
    this.pending = null;
    this.filed = null;
    this.transferred = false;
    this.ended = false;
    this.silences = 0;
    this.agentSpokeLast = false;
    this.firstHeard = null;
    this.lineKind = null;
    this.calleeSpokeAfterOpening = false;
    this.timers = new Set();
  }

  async run() {
    const { ctx, meta } = this;
    const room = ctx.room;
    this.emitter = createEmitter({ baseUrl: env.webUrl(), key: env.eventsKey(), callId: meta.callId, attempt: meta.attempt, log: this.log });

    this.tts = new elevenlabs.TTS({ ...ttsOptions(meta.voiceSpeed), voiceId: meta.voiceId, apiKey: process.env.ELEVENLABS_API_KEY });
    this.prepareOpening();

    const answer = await waitForCallAnswer(room, (meta.ringTimeoutSec + 8) * 1000);
    if (answer !== "answered") {
      this.ended = true;
      await this.emitter.emit("not_answered", { detail: "It rang out, was busy, or was declined." });
      await closeRoom(room.name, this.log);
      return;
    }

    this.emitter.emit("answered");
    room.on("participantDisconnected", (participant) => this.onParticipantLeft(participant));
    // Recording starts beside the call, never in front of it.
    this.recording = startRecording(room.name, meta, this.log);

    await this.startSession();
    this.armOpening();
    this.after(meta.maxCallMinutes * 60_000, () => this.onTimeLimit());
  }

  after(ms, fn) {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      fn();
    }, ms);
    this.timers.add(timer);
    return timer;
  }

  buildTools() {
    const { rep } = this;
    return {
      transfer_to_rep: llm.tool({
        description:
          `Connect the person on the line to ${rep} right now. Use it only when they are the owner or the manager who decides ` +
          `AND they have just agreed to talk to ${rep}. Never for staff, and never to get past someone who said no.`,
        parameters: z.object({
          note: z.string().describe(`One short line for ${rep}: who this is, and anything they said about how they take bookings.`),
        }),
        execute: async ({ note }) => {
          this.pending = { type: "transfer", note };
          return undefined;
        },
      }),
      end_call: llm.tool({
        description:
          "End the call and file it. Use it when the conversation is over, for a voicemail or phone menu, a wrong number, " +
          "or when they ask you to stop. The goodbye is spoken for you, then the line closes: write nothing else in that reply.",
        parameters: z.object({
          goodbye: z.string().describe("Your last words before hanging up: one short, warm sentence. For voicemail or a phone menu, the call-back message."),
          outcome: z.enum(AGENT_OUTCOMES).describe(
            "owner_callback: the owner wants a follow-up later (a call back at a time, or an email). not_interested: the owner said no. " +
              "message_left: staff will pass the message on. call_back_later: staff gave a better time to call. " +
              "refused: staff would not help, or said the restaurant is not interested. voicemail, phone_menu, wrong_number: no person to talk to. " +
              "do_not_call: they asked not to be called again. other: anything else.",
          ),
          summary: z.string().describe("Two short factual sentences: who you spoke to and what was agreed. Only what was said."),
          ownerReached: z.boolean().describe("True only if you spoke to the owner or the manager who decides."),
          contactName: z.string().optional().describe("Their name, or the owner's name, if someone gave it."),
          callbackTime: z.string().optional().describe("When to call back, in their words."),
          bookingSystem: z.string().optional().describe("The booking system or method they said they use."),
          interested: z.boolean().optional().describe("Whether the owner sounded interested. Leave out if you did not speak to the owner."),
        }),
        execute: async ({ goodbye, ...filed }) => {
          // "Not interested" from someone who is not the owner is staff turning the call away.
          if (filed.outcome === "not_interested" && filed.ownerReached === false) filed.outcome = "refused";
          this.filed = filed;
          this.pending = { type: "end", goodbye };
          return undefined;
        },
      }),
    };
  }

  async startSession() {
    const { meta } = this;
    this.llm = new anthropic.LLM({ ...VOICE.llm, apiKey: process.env.ANTHROPIC_API_KEY });
    const turnDetection =
      env.turnDetector() === "multilingual"
        ? new (require("@livekit/agents-plugin-livekit").turnDetector.MultilingualModel)(0.15)
        : "stt";

    this.session = new voice.AgentSession({
      vad: this.vad,
      stt: new soniox.STT({
        ...VOICE.stt,
        apiKey: process.env.SONIOX_API_KEY,
        context: {
          general: [{ key: "domain", value: "A phone call to a restaurant" }],
          terms: [...BOOKING_TERMS, meta.company, meta.repName, meta.label].filter(Boolean),
        },
      }),
      tts: this.tts,
      llm: this.llm,
      turnHandling: { turnDetection, endpointing: VOICE.endpointing, interruption: VOICE.interruption },
      maxToolSteps: VOICE.session.maxToolSteps,
      transcriptionTimeout: VOICE.session.transcriptionTimeout,
      userAwayTimeout: VOICE.session.userAwayTimeoutSec,
      connOptions: { llmConnOptions: { maxRetry: 1, timeoutMs: VOICE.session.llmTimeoutMs }, maxUnrecoverableErrors: 50 },
      ttsTextTransforms: ["filter_markdown", "filter_emoji"],
    });

    this.session.on(Events.ConversationItemAdded, (event) => this.onItem(event.item));
    this.session.on(Events.UserStateChanged, (event) => {
      this.userState = event.newState;
      // They stopped talking ("Hello?"): answer at once, without waiting for the words to be transcribed.
      if (event.oldState === "speaking" && event.newState === "listening") this.sayOpening();
      if (event.newState === "away") this.onSilence();
    });
    this.session.on(Events.AgentStateChanged, (event) => {
      this.agentState = event.newState;
    });
    this.session.on(Events.FunctionToolsExecuted, () => this.runPending());
    this.session.on(Events.Error, (event) => this.log.warn(`[Call] session error: ${event.error && event.error.message}`));
    this.session.on(Events.Close, (event) => {
      if (!this.transferred) this.finalize(event.error ? "error" : "agent_ended");
    });

    this.agent = new OutreachAgent(this, { instructions: buildInstructions(meta, this.openingLine), tools: this.buildTools() });
    await this.session.start({
      agent: this.agent,
      room: this.ctx.room,
      inputOptions: {
        audioSampleRate: 16000,
        audioNumChannels: 1,
        noiseCancellation: TelephonyBackgroundVoiceCancellation(),
        // Only the dialled phone is listened to: the rep joining later is never transcribed or answered.
        participantIdentity: CALLEE_IDENTITY,
        closeOnDisconnect: false,
      },
      outputOptions: { audioSampleRate: 16000, audioNumChannels: 1, syncTranscription: false },
    });
  }

  onItem(item) {
    const role = item && item.role === "assistant" ? "agent" : item && item.role === "user" ? "callee" : null;
    const text = item && typeof item.textContent === "string" ? item.textContent.trim() : "";
    if (!role || !text) return;
    // Whether the agent has spoken since they last did: a goodbye already said is not said twice.
    this.agentSpokeLast = role === "agent";
    if (role === "callee" && this.openingDone) this.calleeSpokeAfterOpening = true;
    this.lines.push({ role, text });
    this.emitter.line(role, text);
  }

  /** Speak first if they say nothing; if they are mid-greeting, wait for them (up to a cap). */
  armOpening() {
    this.after(TIMING.openingWaitMs, () => {
      if (this.userState !== "speaking") return this.sayOpening();
      this.after(TIMING.openingHardCapMs - TIMING.openingWaitMs, () => this.sayOpening());
    });
  }

  /**
   * The opening line's audio is made while the phone is still ringing, so it
   * starts the moment they have said hello and not a second later.
   */
  prepareOpening() {
    this.openingFrames = null;
    (async () => {
      const frames = [];
      for await (const audio of this.tts.synthesize(this.openingLine)) if (audio && audio.frame) frames.push(audio.frame);
      if (frames.length) this.openingFrames = frames;
    })().catch((err) => this.log.warn(`[Call] the opening line was not made ahead: ${err.message}`));
  }

  /**
   * What they said before the opening line finished. The first of it tells the
   * model who answered (and is judged: person, voicemail or menu); all of it
   * goes in the transcript. If the opening has not started yet, it starts now.
   */
  onEarlyWords(text) {
    const heard = String(text || "").trim();
    if (heard) {
      this.lines.push({ role: "callee", text: heard });
      this.emitter.line("callee", heard);
    }
    if (heard && !this.firstHeard) {
      this.firstHeard = heard;
      this.lineCheck = classifyLine({ llmModel: this.llm, firstHeard: heard, ChatContext: llm.ChatContext, log: this.log }).then((kind) => {
        this.lineKind = kind;
        return kind;
      });
      if (this.agent) {
        Promise.resolve(this.agent.updateInstructions(buildInstructions(this.meta, this.openingLine, { firstHeard: heard }))).catch((err) =>
          this.log.warn(`[Call] could not add their first words to the instructions: ${err.message}`),
        );
      }
    }
    this.sayOpening();
  }

  sayOpening() {
    if (this.openingSaid || this.ended || !this.session) return;
    this.openingSaid = true;
    // Not interruptible: the person must hear that this is an AI, who it calls for and why.
    const options = { allowInterruptions: false, addToChatCtx: true };
    const frames = this.openingFrames;
    if (frames) {
      options.audio = new ReadableStream({
        start(controller) {
          for (const frame of frames) controller.enqueue(frame);
          controller.close();
        },
      });
    }
    const handle = this.session.say(this.openingLine, options);
    handle
      .waitForPlayout()
      .catch(() => undefined)
      .then(() => {
        this.openingDone = true;
        // A recording says nothing back. A person answers "is the owner around?" within a few seconds.
        this.after(TIMING.recordingSilenceMs, () => this.onQuietAfterOpening());
      });
  }

  /**
   * The line has gone quiet. If a recording answered, file the call and set
   * the ending up; returns whether it did. A person is left to the model.
   */
  async handleQuietLine() {
    const kind = this.lineKind || (this.lineCheck ? await this.lineCheck : "person");
    if (kind === "person" || this.ended || this.pending) return false;
    const { meta, rep } = this;
    const voicemail = kind === "voicemail";
    this.filed = {
      outcome: voicemail ? "voicemail" : "phone_menu",
      summary: voicemail ? "Voicemail answered. The call-back message was left." : "A phone menu answered. There was nobody to talk to.",
      ownerReached: false,
    };
    // A menu is not listening; a voicemail is, so it gets the message.
    const message = voicemail && meta.callbackNumberSpoken ? `Please call ${rep} from ${meta.company} back on ${meta.callbackNumberSpoken}.` : null;
    this.pending = { type: "end", goodbye: message };
    this.agentSpokeLast = false;
    return true;
  }

  async onQuietAfterOpening() {
    if (this.ended || this.pending || this.transferred || this.calleeSpokeAfterOpening || this.userState === "speaking") return;
    if (await this.handleQuietLine()) await this.runPending();
  }

  /** What a tool asked for runs here, after the tool has returned and the agent has finished its sentence. */
  async runPending() {
    const action = this.pending;
    if (!action || action.running || this.ended) return;
    action.running = true;
    await sleep(200);
    for (let waited = 0; this.agentState === "speaking" && waited < 10_000; waited += 100) await sleep(100);
    if (action.type === "transfer") {
      return this.transfer(action.note).catch((err) => this.log.error(`[Call] transfer crashed: ${err.stack || err}`));
    }
    if (action.goodbye && !this.agentSpokeLast) {
      await this.session.say(action.goodbye, { allowInterruptions: false }).waitForPlayout().catch(() => undefined);
    }
    return this.finalize("agent_ended");
  }

  async transfer(note) {
    if (this.ended) return;
    const { meta, rep } = this;
    this.emitter.emit("stage", { stage: "transferring" });
    if (note) this.noteLine(`For ${rep}: ${note}`);
    await this.session.say(`One moment, I'll put ${rep} on now.`, { allowInterruptions: false }).waitForPlayout().catch(() => undefined);
    this.session.input.setAudioEnabled(false);

    try {
      await dialRep(this.ctx.room.name, meta);
    } catch (err) {
      if (this.ended) return;
      this.log.warn(`[Call] ${rep} did not pick up: ${err.message}`);
      this.pending = null;
      this.session.input.setAudioEnabled(true);
      this.emitter.emit("stage", { stage: "talking" });
      this.noteLine(`${rep} did not pick up.`);
      this.session.generateReply({
        instructions:
          `${rep} did not pick up just now. Tell them so in one short sentence, say ${rep} will call them back, and ask what time suits. ` +
          `After they answer, end the call with outcome owner_callback.`,
      });
      return;
    }

    if (this.ended) return;
    this.transferred = true;
    this.emitter.emit("stage", { stage: "with_rep" });
    this.noteLine(`Connected to ${meta.repName}. They talked directly from here.`);
    // The agent goes quiet and stays in the room; the call ends when either of them hangs up.
    await this.session.close().catch(() => undefined);
  }

  /** A note about the call itself, for the screen and for the summary written afterwards. */
  noteLine(text) {
    this.lines.push({ role: "system", text });
    this.emitter.line("system", text);
  }

  onParticipantLeft(participant) {
    const who = participant && participant.identity;
    if (who === CALLEE_IDENTITY) this.finalize(this.transferred ? "transferred" : "callee_hung_up");
    else if (who === REP_IDENTITY && this.transferred) this.finalize("transferred");
  }

  /** Nobody has spoken for a while: check the line once, then let go. */
  async onSilence() {
    if (this.ended || this.pending || this.transferred || !this.openingSaid) return;
    this.silences += 1;
    if (this.silences >= 2) return this.finalize("agent_ended");
    if (!this.calleeSpokeAfterOpening && (await this.handleQuietLine())) return this.runPending();
    if (!this.ended && !this.pending) this.session.generateReply({ instructions: NUDGES.stillThere });
  }

  onTimeLimit() {
    if (this.ended || this.transferred) return;
    this.session.generateReply({ instructions: NUDGES.timeLimit });
    this.after(TIMING.timeLimitGraceMs, () => this.finalize("time_limit"));
  }

  /** Close the call once, whatever ended it: stop the recording, file it, hang up. */
  async finalize(endReason) {
    if (this.ended) return;
    this.ended = true;
    for (const timer of this.timers) clearTimeout(timer);
    const { meta, ctx } = this;
    const roomName = ctx.room.name;

    const egressId = await Promise.resolve(this.recording).catch(() => null);
    let filed = this.filed;
    if (!filed && endReason !== "error") {
      filed = await wrapUp({ llmModel: this.llm, lines: this.lines, meta, ChatContext: llm.ChatContext, log: this.log });
    }
    filed = filed || {};

    this.emitter.emit("ended", {
      endReason: this.transferred ? "transferred" : endReason,
      transferred: this.transferred || undefined,
      outcome: filed.outcome || null,
      summary: filed.summary || null,
      ownerReached: this.transferred ? true : (filed.ownerReached ?? null),
      contactName: filed.contactName || null,
      callbackTime: filed.callbackTime || null,
      bookingSystem: filed.bookingSystem || null,
      interested: this.transferred ? true : (filed.interested ?? null),
    });

    const recording = await stopRecording(egressId, meta, this.log);
    await closeRoom(roomName, this.log);
    if (recording) this.emitter.emit("recording", recording);
    await this.emitter.flush();
    if (this.session && !this.transferred) await this.session.close().catch(() => undefined);
    if (typeof ctx.shutdown === "function") ctx.shutdown("call ended");
  }
}

module.exports = { OutreachCall, OutreachAgent, CALLEE_IDENTITY, NUDGES };
