"use strict";

const path = require("path");
// OUTREACH_ENV_FILE picks another file in apps/agent (".env.prod": the deployed app's keys).
require("dotenv").config({ path: path.join(__dirname, "..", process.env.OUTREACH_ENV_FILE || ".env") });

// The voice stack, with the same settings the Forktime phone agent runs on
// (packages/agent in forktime-core): Soniox for listening, ElevenLabs for the
// voice, Claude Haiku for the words.

/** Words a restaurant phone call is full of; they bias the speech-to-text toward them. */
const BOOKING_TERMS = [
  "owner",
  "manager",
  "booking",
  "bookings",
  "reservation",
  "reservations",
  "table",
  "call back",
  "voicemail",
  "Forktime",
  "OpenTable",
  "SevenRooms",
  "ResDiary",
  "NowBookIt",
  "Resy",
  "Quandoo",
  "TheFork",
  "Square",
  "booking system",
  "AI assistant",
];

const VOICE = {
  stt: {
    model: "stt-rt-v6",
    languageHints: ["en"],
    languageHintsStrict: true,
    sampleRate: 16000,
    maxEndpointDelayMs: 800,
    enableSpeakerDiarization: false,
    enableLanguageIdentification: true,
  },
  tts: {
    encoding: "pcm_16000",
    // The most natural model. It is a dialogue model: it takes stability and
    // nothing else, so it has one speaking speed.
    natural: { model: "eleven_v4_turbo", voiceSettings: { stability: 0.6 } },
    // The model that takes a speed (up to 1.2). Measured on the same line and
    // voice: 9.4 s on v4 Turbo, 6.8 s here at 1.2.
    paced: {
      model: "eleven_flash_v2_5",
      voiceSettings: { stability: 0.6, similarity_boost: 0.75, style: 0.0, use_speaker_boost: false },
    },
    maxSpeed: 1.2,
  },
  llm: {
    model: process.env.OUTREACH_LLM_MODEL || "claude-haiku-4-5",
    temperature: 0.4,
    maxTokens: 300,
  },
  vad: { activationThreshold: 0.5 },
  // Milliseconds.
  endpointing: { mode: "fixed", minDelay: 600, maxDelay: 1000 },
  interruption: {
    enabled: true,
    mode: "vad",
    minDuration: 500,
    minWords: 2,
    discardAudioIfUninterruptible: true,
    resumeFalseInterruption: false,
  },
  session: {
    maxToolSteps: 2,
    transcriptionTimeout: 1500,
    llmTimeoutMs: 15000,
    /** Seconds of silence from both sides before the agent checks the line. */
    userAwayTimeoutSec: 12,
  },
};

const TIMING = {
  /**
   * After the pickup, how long to wait for their "hello" before speaking first.
   * Any longer and the person hears a dead line and starts saying "hello? hello?".
   */
  openingWaitMs: 900,
  /** If they are still talking then, the longest the opening line waits for them to finish. */
  openingHardCapMs: 6000,
  /** After the agent's last words, how long before the line is closed, so the words are not cut off. */
  hangupDelayMs: 1200,
  /** After the opening line, how long a recording is given to stay silent before the call is ended. */
  recordingSilenceMs: 4000,
  /** How long the rep's phone rings on a transfer. */
  transferRingSec: 25,
  /** After the agent is told to wrap up at the time limit, how long before the line is cut. */
  timeLimitGraceMs: 20000,
};

/**
 * The voice model and its settings for a speaking speed. Normal speed (1, or
 * anything that is not a number) is the natural model; faster is the paced
 * model at that speed, capped at its limit. Pure.
 */
function ttsOptions(voiceSpeed) {
  const speed = Math.min(Number(voiceSpeed) || 1, VOICE.tts.maxSpeed);
  if (!(speed > 1)) return { encoding: VOICE.tts.encoding, ...VOICE.tts.natural };
  return {
    encoding: VOICE.tts.encoding,
    model: VOICE.tts.paced.model,
    voiceSettings: { ...VOICE.tts.paced.voiceSettings, speed },
  };
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set (apps/agent/.env)`);
  return value;
}

const env = {
  agentName: () => process.env.OUTREACH_AGENT_NAME || "outreach-agent",
  webUrl: () => (process.env.OUTREACH_WEB_URL || "http://localhost:3100").replace(/\/$/, ""),
  eventsKey: () => required("AGENT_EVENTS_KEY"),
  livekit: () => ({
    url: required("LIVEKIT_URL").replace("wss://", "https://").replace("ws://", "http://"),
    apiKey: required("LIVEKIT_API_KEY"),
    apiSecret: required("LIVEKIT_API_SECRET"),
  }),
  outboundTrunkId: () => required("SIP_OUTBOUND_TRUNK_ID"),
  outboundTrunkIdAu: () => process.env.SIP_OUTBOUND_TRUNK_ID_AU || "",
  /** "stt" (the speech-to-text's own end-of-turn) or "multilingual" (LiveKit's model, as the phone agent uses). */
  turnDetector: () => (process.env.TURN_DETECTOR === "multilingual" ? "multilingual" : "stt"),
  recording: () => ({
    bucket: process.env.EGRESS_S3_BUCKET || "",
    accessKey: process.env.EGRESS_S3_ACCESS_KEY || "",
    secret: process.env.EGRESS_S3_SECRET || "",
    endpoint: process.env.EGRESS_S3_ENDPOINT || "",
    region: process.env.EGRESS_S3_REGION || "auto",
    publicUrl: (process.env.EGRESS_S3_PUBLIC_URL || "").replace(/\/$/, ""),
  }),
};

module.exports = { VOICE, TIMING, BOOKING_TERMS, env, ttsOptions };
