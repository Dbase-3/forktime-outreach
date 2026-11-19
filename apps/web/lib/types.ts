import type { Outcome } from "./outcomes";

/** queued → dialing → live → ended; cancelled from queued. */
export type CallStatus = "queued" | "dialing" | "live" | "ended" | "cancelled";

/** What is happening on a live call right now. */
export type CallStage = "talking" | "transferring" | "with_rep";

export interface Settings {
  /** The assistant's first name, as it introduces itself. */
  agentName: string;
  /** The person the assistant calls for, and connects the owner to. */
  repName: string;
  company: string;
  /** What the call is about, said in the first breath and whenever asked. */
  topic: string;
  /** Where an interested owner is connected. E.164. */
  transferNumber: string;
  /** The number staff are asked to pass to the owner. E.164. */
  callbackNumber: string;
  /** ElevenLabs voice id. */
  voiceId: string;
  /**
   * How fast the voice speaks: 1 is normal, up to 1.2. Normal uses the most
   * natural voice model, which has one fixed speed; anything faster uses the
   * model that takes a speed (the agent picks, apps/agent/src/config.js).
   */
  voiceSpeed: number;
  /** Caller ID for new calls: one of the carrier account's numbers. E.164. */
  fromNumber: string;
  /** Calls go out only inside this window, on this clock. */
  timezone: string;
  windowStart: string;
  windowEnd: string;
  /** 1 = Monday … 7 = Sunday. */
  windowDays: number[];
  enforceWindow: boolean;
  /** Tries per number, the first call included. */
  maxAttempts: number;
  retryAfterMinutes: number;
  ringTimeoutSec: number;
  maxCallMinutes: number;
  recordCalls: boolean;
  /** Say "this call is recorded" in the opening line. */
  recordingNotice: boolean;
  /** Region for numbers typed without a country code. */
  defaultCountry: string;
}

export interface CallRecording {
  url: string | null;
  durationSec: number | null;
}

export interface Call {
  _id: string;
  batchId: string;
  phone: string;
  label: string;
  status: CallStatus;
  stage: CallStage | null;
  outcome: Outcome | null;
  /** True while the line is in use; a unique index allows one at a time. */
  active?: true;
  attempt: number;
  order: number;
  fromNumber: string;
  roomName: string | null;
  /** A queued call is not dialled before this moment (a retry). */
  notBefore: Date | null;
  queuedAt: Date;
  startedAt: Date | null;
  answeredAt: Date | null;
  endedAt: Date | null;
  durationSec: number | null;
  summary: string | null;
  ownerReached: boolean | null;
  contactName: string | null;
  callbackTime: string | null;
  bookingSystem: string | null;
  interested: boolean | null;
  recording: CallRecording | null;
  error: string | null;
  /** A dry-run call is acted out by the app; nothing is dialled. */
  simulated: boolean;
  simStep?: number;
}

export type TranscriptRole = "agent" | "callee" | "system";

export interface TranscriptLine {
  _id: string;
  callId: string;
  seq: number;
  role: TranscriptRole;
  text: string;
  at: Date;
}

export interface QueueState {
  running: boolean;
}

export interface DncEntry {
  _id: string;
  phone: string;
  reason: string;
  addedAt: Date;
  sourceCallId: string | null;
}

/** JSON shape of a call as the API returns it (dates as ISO strings). */
export type CallJson = Omit<Call, "notBefore" | "queuedAt" | "startedAt" | "answeredAt" | "endedAt" | "active"> & {
  notBefore: string | null;
  queuedAt: string;
  startedAt: string | null;
  answeredAt: string | null;
  endedAt: string | null;
};

export type TranscriptLineJson = Omit<TranscriptLine, "at"> & { at: string };
