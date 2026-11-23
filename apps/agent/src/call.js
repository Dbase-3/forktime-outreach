"use strict";

const { voice, llm, inference } = require("@livekit/agents");
const anthropic = require("@livekit/agents-plugin-anthropic");
const elevenlabs = require("@livekit/agents-plugin-elevenlabs");
const fishaudio = require("@livekit/agents-plugin-fishaudio");
const soniox = require("@livekit/agents-plugin-soniox");
const { TelephonyBackgroundVoiceCancellation } = require("@livekit/noise-cancellation-node");
const { z } = require("zod");

const { VOICE, TIMING, BOOKING_TERMS, env, voiceSetup } = require("./config");
const { waitForCallAnswer } = require("./callAnswer");
const { createEmitter } = require("./events");
const { classifyLine } = require("./lineCheck");
const { firstName, resolveOpeningLine } = require("./opening");
const { AGENT_OUTCOMES, filedOutcome } = require("./outcomes");
const { asksForPhoneNumber, isIncompletePhoneReply } = require("./phone-input");
const { buildInstructions } = require("./prompt");
const { startRecording, stopRecording } = require("./recording");
const { dialRep, closeRoom, REP_IDENTITY } = require("./transfer");
const { wrapUp } = require("./wrapup");

// One outbound call, start to finish: wait for the pickup, say the opening
// line, let the model talk, then file the call with the app.

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
    if (!this.call.openingDone) {
      this.call.onEarlyWords(newMessage && newMessage.textContent);
      throw new voice.StopResponse();
    }
    if (!this.call.acceptCallerTurn(newMessage)) throw new voice.StopResponse();
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
    this.previousNote = meta.previousNote || null;
    this.calleeIdentity = CALLEE_IDENTITY;
    this.lineKind = null;
    this.calleeSpokeAfterOpening = false;
    this.awaitingPhone = false;
    this.phoneFragments = [];
    this.timers = new Set();
  }

  makeTts() {
    const { meta } = this;
    const setup = voiceSetup({ provider: meta.voiceProvider, voiceId: meta.voiceId, voiceSpeed: meta.voiceSpeed });
    return setup.provider === "fishaudio" ? new fishaudio.TTS(setup.options) : new elevenlabs.TTS(setup.options);
  }

  /**
   * An inbound call: someone rang the call-back number and is already on the
   * line, so there is no ringing to wait out. The agent speaks first, at once.
   */
  async runInbound(participant) {
    const { ctx, meta } = this;
    this.calleeIdentity = participant.identity;
    this.emitter = createEmitter({ baseUrl: env.webUrl(), key: env.eventsKey(), callId: meta.callId, attempt: meta.attempt, log: this.log });
    this.tts = this.makeTts();
    ctx.room.on("participantDisconnected", (left) => this.onParticipantLeft(left));
    this.recording = startRecording(ctx.room.name, meta, this.log);

    await this.startSession();
    // A short beat so the line is settled, then the welcome: nobody should wait for it.
    this.after(TIMING.inboundWelcomeMs, () => this.sayOpening());
    this.after(meta.maxCallMinutes * 60_000, () => this.onTimeLimit());
  }

  async run() {
    const { ctx, meta } = this;
    const room = ctx.room;
    this.emitter = createEmitter({ baseUrl: env.webUrl(), key: env.eventsKey(), callId: meta.callId, attempt: meta.attempt, log: this.log });

    this.tts = this.makeTts();
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
    const { meta, rep } = this;
    return {
      ...(meta.direction === "inbound" && meta.transferNumber ? { transfer_to_rep: llm.tool({
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
      }) } : {}),
      end_call: llm.tool({
        description:
          "End the call and file it. Use it when the conversation is over, for a voicemail or phone menu, a wrong number, " +
          "or when they ask you to stop. The goodbye is spoken for you, then the line closes: write nothing else in that reply.",
        parameters: z.object({
          goodbye: z.string().describe("Your last words before hanging up: one short, warm sentence. For voicemail or a phone menu, the call-back message."),
          outcome: z.enum(AGENT_OUTCOMES).describe(
            "owner_callback: the owner explicitly agreed to a callback. not_interested: the owner said no. " +
              "not_a_fit: the restaurant cannot accommodate the group. " +
              "message_left: the owner was not there and staff could not say when they will be. call_back_later: staff gave a time (or the owner's usual hours) to call back. " +
              "refused: staff would not help, or said the restaurant is not interested. voicemail, phone_menu, wrong_number: no person to talk to. " +
              "do_not_call: they asked not to be called again. other: anything else.",
          ),
          summary: z.string().describe("Two short factual sentences: who you spoke to and what was agreed. Describe callbacks as requested or agreed, since this tool only records the details."),
          ownerReached: z.boolean().describe("True if you spoke to the owner, or to a manager who says they make the decisions (\"I'm the manager, I make the calls\"). False for staff such as waiters or hosts."),
          restaurantName: z.string().max(160).optional().describe("Restaurant name, if stated or already on the call record."),
          contactName: z.string().optional().describe("Their name, or the owner's name, if someone gave it."),
          callbackNumber: z.string().max(80).optional().describe("Direct business phone number or the number they confirmed for a callback."),
          callbackTime: z.string().optional().describe("The requested callback date and time, or when the owner is free, in their words."),
          callbackPermission: z.boolean().optional().describe("True only if the owner or manager explicitly agreed to a callback. False when they declined. Omit if unknown."),
          takesLargeBookings: z.boolean().optional().describe("Whether they take large bookings. Leave out if not asked or not said."),
          takesCatering: z.boolean().optional().describe("Whether they confirmed or declined catering specifically. A general yes to catering or group bookings is ambiguous. Omit if unknown."),
          seats: z.number().int().optional().describe("How many people they can seat, as a whole number, whenever they gave any figure (\"about twelve\" is 12). Leave out only if they gave none."),
          capacityNote: z.string().optional().describe("Their capacity answer in their own words, if it was not a plain number."),
          dietaryOptions: z.string().max(200).optional().describe("The dietary accommodations they confirmed, including vegetarian or gluten-free options."),
          bookingSystem: z.string().max(120).optional().describe("The reservation system they said they currently use."),
          interestedInBookingInquiries: z.boolean().optional().describe("Whether the owner explicitly expressed interest in more reservation or catering inquiries. Omit if unclear."),
          interestedInSystem: z.boolean().optional().describe("Whether the owner explicitly expressed interest in the AI phone assistant. Omit if unclear."),
          interested: z.boolean().optional().describe("Whether the owner expressed interest in either Fork Time service. Omit if unclear."),
        }),
        execute: async ({ goodbye, ...filed }) => {
          filed.outcome = filedOutcome(filed);
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
      if (event.newState === "speaking") this.silences = 0;
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

    this.agent = new OutreachAgent(this, { instructions: buildInstructions(meta, this.openingLine, { previous: this.previousNote }), tools: this.buildTools() });
    await this.session.start({
      agent: this.agent,
      room: this.ctx.room,
      inputOptions: {
        audioSampleRate: 16000,
        audioNumChannels: 1,
        noiseCancellation: TelephonyBackgroundVoiceCancellation(),
        // Only the dialled phone is listened to: the rep joining later is never transcribed or answered.
        participantIdentity: this.calleeIdentity,
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
    if (role === "agent" && asksForPhoneNumber(text)) this.setAwaitingPhone(true);
    if (role === "callee" && this.openingDone) this.calleeSpokeAfterOpening = true;
    this.lines.push({ role, text });
    this.emitter.line(role, text);
  }

  setAwaitingPhone(enabled) {
    if (this.awaitingPhone === enabled) return;
    this.awaitingPhone = enabled;
    const endpointing = enabled ? VOICE.phoneEndpointing : VOICE.endpointing;
    this.session.updateOptions({ turnHandling: { endpointing } });
  }

  /** Keep listening if a pause split a phone number into separate SDK turns. */
  acceptCallerTurn(message) {
    if (!this.awaitingPhone) return true;
    const text = message.textContent.trim();
    const combined = [...this.phoneFragments, text].join(" ").trim();
    if (isIncompletePhoneReply(combined)) {
      if (text) this.phoneFragments.push(text);
      return false;
    }
    if (this.phoneFragments.length) message.content = [combined];
    this.phoneFragments = [];
    this.setAwaitingPhone(false);
    return true;
  }

  /** Speak first if they say nothing. If they are mid-greeting, the listening event starts the opener. */
  armOpening() {
    this.after(TIMING.openingWaitMs, () => this.sayOpening());
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
        Promise.resolve(this.agent.updateInstructions(buildInstructions(this.meta, this.openingLine, { firstHeard: heard, previous: this.previousNote }))).catch((err) =>
          this.log.warn(`[Call] could not add their first words to the instructions: ${err.message}`),
        );
      }
    }
    this.sayOpening();
  }

  sayOpening() {
    if (this.openingSaid || this.ended || this.userState === "speaking" || !this.session) return;
    this.openingSaid = true;
    const options = { allowInterruptions: true, addToChatCtx: true };
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
        // A recording says nothing back. A person usually answers the opening question.
        this.after(TIMING.recordingSilenceMs, () => this.onQuietAfterOpening());
      });
  }

  /**
   * The line has gone quiet. If a recording answered, file the call and set
   * the ending up; returns whether it did. A person is left to the model.
   */
  async handleQuietLine() {
    const kind = this.lineKind || (this.lineCheck ? await this.lineCheck : "person");
    if (kind === "person" || this.ended || this.pending || this.userState === "speaking") return false;
    const { meta } = this;
    const voicemail = kind === "voicemail";
    this.filed = {
      outcome: voicemail ? "voicemail" : "phone_menu",
      summary: voicemail ? "Voicemail answered. The call-back message was left." : "A phone menu answered. There was nobody to talk to.",
      ownerReached: false,
    };
    // A menu is not listening; a voicemail is, so it hears who called and why (no number: the team calls again).
    const message = voicemail ? `This is ${meta.agentName} calling about potential group reservations and catering inquiries. Please call us back when you can. Thank you.` : null;
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
    if (this.ended) return;
    if (this.userState === "speaking") {
      this.pending = null;
      this.filed = null;
      return;
    }
    if (action.type === "transfer") {
      return this.transfer(action.note).catch((err) => this.log.error(`[Call] transfer crashed: ${err.stack || err}`));
    }
    if (action.goodbye && !this.agentSpokeLast) {
      const goodbye = this.session.say(action.goodbye, { allowInterruptions: true });
      await goodbye.waitForPlayout().catch(() => undefined);
      if (goodbye.interrupted) {
        this.pending = null;
        this.filed = null;
        return;
      }
    }
    // Let the last words finish on the phone before the line is closed: the audio is still in transit.
    await sleep(TIMING.hangupDelayMs);
    if (this.userState === "speaking") {
      this.pending = null;
      this.filed = null;
      return;
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
          `${rep} did not pick up just now. Tell them so in one short sentence and ask if the team may call them back. ` +
          `If they agree, ask what time suits and file their callback permission.`,
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
    if (who === this.calleeIdentity) this.finalize(this.transferred ? "transferred" : "callee_hung_up");
    else if (who === REP_IDENTITY && this.transferred) this.finalize("transferred");
  }

  /** Nobody has spoken for a while: check the line once, then let go. */
  async onSilence() {
    if (this.ended || this.pending || this.transferred || !this.openingSaid || this.userState === "speaking") return;
    this.silences += 1;
    if (this.silences >= 2) return this.finalize("agent_ended");
    if (!this.calleeSpokeAfterOpening && (await this.handleQuietLine())) return this.runPending();
    if (this.ended || this.pending || this.userState === "speaking") return;
    if (this.awaitingPhone) {
      this.phoneFragments = [];
      this.session.generateReply({ instructions: "Ask once for the full callback number. Then wait for the answer." });
    } else {
      this.session.generateReply({ instructions: NUDGES.stillThere });
    }
  }

  onTimeLimit() {
    if (this.ended || this.transferred) return;
    if (this.userState !== "speaking") this.session.generateReply({ instructions: NUDGES.timeLimit });
    this.after(TIMING.timeLimitGraceMs, () => this.finalize("time_limit"));
  }

  /** Close the call once, whatever ended it: stop the recording, file it, hang up. */
  async finalize(endReason) {
    if (this.ended) return;
    this.ended = true;
    for (const timer of this.timers) clearTimeout(timer);
    const { meta, ctx } = this;
    const roomName = ctx.room.name;
    if (this.phoneFragments.length && this.emitter) {
      const text = this.phoneFragments.join(" ");
      this.lines.push({ role: "callee", text });
      this.emitter.line("callee", text);
    }

    const egressId = await Promise.resolve(this.recording).catch(() => null);
    let filed = this.filed;
    if (!filed && endReason !== "error") {
      filed = await wrapUp({ llmModel: this.llm, lines: this.lines, meta, ChatContext: llm.ChatContext, log: this.log });
    }
    filed = filed || {};

    this.emitter.emit("ended", {
      endReason: this.transferred ? "transferred" : endReason,
      transferred: this.transferred || undefined,
      outcome: filedOutcome(filed),
      summary: filed.summary || null,
      ownerReached: this.transferred ? true : (filed.ownerReached ?? null),
      restaurantName: filed.restaurantName || null,
      contactName: filed.contactName || null,
      callbackNumber: filed.callbackNumber || null,
      callbackTime: filed.callbackTime || null,
      callbackPermission: filed.ownerReached === true ? (filed.callbackPermission ?? null) : null,
      takesLargeBookings: filed.takesLargeBookings ?? null,
      takesCatering: filed.takesCatering ?? null,
      seats: filed.seats ?? null,
      capacityNote: filed.capacityNote || null,
      dietaryOptions: filed.dietaryOptions || null,
      bookingSystem: filed.bookingSystem || null,
      interestedInBookingInquiries: filed.interestedInBookingInquiries ?? null,
      interestedInSystem: filed.interestedInSystem ?? null,
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
