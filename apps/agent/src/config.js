"use strict";

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });

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
    model: "eleven_v4_turbo",
    encoding: "pcm_16000",
    // v4 is a dialogue model: it takes stability and nothing else.
    voiceSettings: { stability: 0.6 },
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
  /** After the pickup, how long to wait for their "hello" before speaking first. */
  openingWaitMs: 2500,
  /** If they are still talking then, the longest the opening line waits for them to finish. */
  openingHardCapMs: 9000,
  /** After the opening line, how long a recording is given to stay silent before the call is ended. */
  recordingSilenceMs: 4000,
  /** How long the rep's phone rings on a transfer. */
  transferRingSec: 25,
  /** After the agent is told to wrap up at the time limit, how long before the line is cut. */
  timeLimitGraceMs: 20000,
};

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

module.exports = { VOICE, TIMING, BOOKING_TERMS, env };
