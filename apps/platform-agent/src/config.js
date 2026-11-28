"use strict";

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

// The voice stack, the same as the outreach agent's (apps/agent/src/config.js):
// Soniox listens, ElevenLabs speaks, Claude Haiku words the replies.

/** The voices the editor offers (packages/core/src/voices.ts) and the ElevenLabs voice behind each. */
const VOICE_IDS = {
  v_ava: "r1KmysJdVYZjJCm4mL3b", // Jessica: American, warm, bright
  v_noah: "UgBBYS2sOqTuMpoF3BR0", // Mark: American, natural conversation
  v_mia: "nBoLwpO4PAjQaQwVKPI1", // Amelia: Australian, young
  v_jack: "DYkrAHD8iwork3YSUBbs", // Tom: Australian, conversational
  v_olivia: "Xb7hH8MSUJpSbSDYk0k2", // Alice: British, clear
  v_george: "JBFqnCBsd6RMkjVDRZzb", // George: British, warm
  v_chloe: "TgnhEILA8UwUqIMi20rp", // Jenna: Canadian, warm
  v_liam: "eZm9vdjYgL9PZKtf7XMM", // Noah: Canadian, chill
  v_priya: "2zRM7PkgwBPiau2jvVXc", // Monika: Indian, pleasant
  v_arjun: "s3TPKV1kjDlVtZbl4Ksh", // no Indian male voice on the account yet: Adam, American, conversational
};

/** Speech-to-text language hints for the editor's languages. */
const LANGUAGE_CODES = { English: "en", Spanish: "es", French: "fr", German: "de", Italian: "it", Portuguese: "pt", Hindi: "hi", Arabic: "ar", Mandarin: "zh" };

const VOICE = {
  // Everything below matches the outreach agent (apps/agent/src/config.js, owner 2026-11-27).
  stt: { model: "stt-rt-v6", languageHintsStrict: true, sampleRate: 16000, maxEndpointDelayMs: 800, enableSpeakerDiarization: false, enableLanguageIdentification: true },
  tts: {
    encoding: "pcm_16000",
    natural: { model: "eleven_v4_turbo", voiceSettings: { stability: 0.6 } },
    paced: { model: "eleven_flash_v2_5", voiceSettings: { stability: 0.6, similarity_boost: 0.75, style: 0.0, use_speaker_boost: false } },
    maxSpeed: 1.2,
  },
  // Claude 5 models refuse a temperature; older ones get the outreach agent's 0.4.
  llm: (() => {
    // Haiku 4.5 (owner 2026-11-27): Haiku 5.5 is slower on calls unless its thinking is turned down,
    // which this plugin can't set. Same model the outreach agent runs on.
    const model = process.env.PLATFORM_LLM_MODEL || "claude-haiku-4-5";
    return /-[5-9]-\d/.test(model) ? { model, maxTokens: 300 } : { model, temperature: 0.4, maxTokens: 300 };
  })(),
  vad: { activationThreshold: 0.5 },
  endpointing: { mode: "fixed", minDelay: 750, maxDelay: 1500 },
  phoneEndpointing: { minDelay: 2400, maxDelay: 3000 },
  interruption: { enabled: true, mode: "vad", minDuration: 400, minWords: 2, discardAudioIfUninterruptible: false, resumeFalseInterruption: true },
  session: { maxToolSteps: 2, transcriptionTimeout: 1500, llmTimeoutMs: 15000, userAwayTimeoutSec: 12 },
};

const TIMING = {
  /** The person is already in the room (a test call, or an answered phone): the greeting starts after this beat. */
  greetingDelayMs: 600,
  /** A phone call that isn't picked up in this long is "no answer" (the API rings for 35 s; this covers the setup). */
  ringMs: 45000,
  /** After the last words, how long before the line is closed, so they aren't cut off. */
  hangupDelayMs: 1200,
  /** After being told to wrap up at the time limit, how long before the line is cut. */
  timeLimitGraceMs: 20000,
};

/** ElevenLabs model and settings for a speaking speed: normal speed gets the most natural model. Pure. */
function ttsOptions(voiceSpeed) {
  const speed = Math.min(Number(voiceSpeed) || 1, VOICE.tts.maxSpeed);
  if (!(speed > 1)) return { encoding: VOICE.tts.encoding, ...VOICE.tts.natural };
  return { encoding: VOICE.tts.encoding, model: VOICE.tts.paced.model, voiceSettings: { ...VOICE.tts.paced.voiceSettings, speed } };
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set (apps/platform-agent/.env)`);
  return value;
}

const env = {
  agentName: () => process.env.PLATFORM_AGENT_NAME || "platform-agent-local",
  apiUrl: () => (process.env.PLATFORM_API_URL || "http://localhost:4300").replace(/\/$/, ""),
  runtimeKey: () => required("AGENT_RUNTIME_KEY"),
  /** LiveKit's audio turn detector by default, as on the outreach agent; "stt" or "multilingual" override it. */
  turnDetector: () => {
    const d = process.env.TURN_DETECTOR;
    return d === "multilingual" || d === "stt" ? d : "audio";
  },
  /** Local and test calls spend on the eval key; a deployed agent sets ANTHROPIC_API_KEY. */
  anthropicKey: () => process.env.ANTHROPIC_API_KEY || required("ANTHROPIC_API_KEY_EVAL"),
};

module.exports = { VOICE, TIMING, VOICE_IDS, LANGUAGE_CODES, env, ttsOptions };
