// Reviewing one call: which line is playing, the caller's mood, the path the
// call took through its flow, and the words for outcomes and feedback. Pure.

import { conditionHolds } from "./automation";
import type { EndReason, FeedbackReason, Step, TranscriptLine } from "./types";

/** "1:05" */
export function clock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * The line being spoken at `t` seconds: the last line that has STARTED. Calls
 * are full of pauses, and holding the last speaker lit through a pause is both
 * true and calmer than the highlight blinking off. -1 before the first line.
 */
export function activeLineAt(lines: TranscriptLine[], t: number): number {
  let active = -1;
  lines.forEach((line, i) => {
    if (line.at !== undefined && line.at <= t) active = i;
  });
  return active;
}

/** Lines that can be clicked to jump the recording there. */
export function hasTimeline(lines: TranscriptLine[]): boolean {
  return lines.some((line) => line.at !== undefined);
}

export interface MoodStats {
  peak: number;
  mean: number;
  turns: number;
  level: "calm" | "uneasy" | "upset";
}

export function moodLevel(score: number): MoodStats["level"] {
  if (score >= 0.7) return "upset";
  if (score >= 0.4) return "uneasy";
  return "calm";
}

export function moodStats(mood: number[] | undefined): MoodStats | null {
  if (!mood || mood.length === 0) return null;
  const peak = Math.max(...mood);
  const mean = mood.reduce((a, b) => a + b, 0) / mood.length;
  return { peak, mean, turns: mood.length, level: moodLevel(peak) };
}

/** Pairs each caller line with its mood score, in order. */
export function callerMoodLines(lines: TranscriptLine[], mood: number[] | undefined): { text: string; score: number }[] {
  if (!mood) return [];
  const said = lines.filter((l) => l.who === "caller").map((l) => l.text);
  return mood.map((score, i) => ({ text: said[i] ?? "", score }));
}

/**
 * Bar heights for a recording's waveform. Real recordings are decoded in the
 * player; sample calls (no audio) get a fixed, natural-looking shape from the
 * call id so the same call always draws the same picture.
 */
export function sampleWaveform(seed: string, bars: number): number[] {
  let x = [...seed].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  const next = () => {
    x = (x * 1664525 + 1013904223) >>> 0;
    return x / 4294967296;
  };
  return Array.from({ length: bars }, (_, i) => {
    const swell = 0.55 + 0.45 * Math.sin((i / bars) * Math.PI * 6 + next());
    return Math.max(0.08, Math.min(1, swell * (0.35 + next() * 0.65)));
  });
}

// ---- The path a call took through its flow ----

export interface FlowPath {
  steps: Step[]; // every step the call reached, in order
  stoppedAt: Step | null; // a question the call never got an answer to
  outcome: string | null;
}

/** Walks the flow with the answers the call saved, the way the call itself went. */
export function flowPath(steps: Step[], values: Record<string, string>): FlowPath {
  const queue = [...steps];
  const reached: Step[] = [];
  while (queue.length > 0) {
    const step = queue.shift() as Step;
    reached.push(step);
    if (step.kind === "ask" && !(values[step.field] ?? "").trim()) return { steps: reached, stoppedAt: step, outcome: null };
    if (step.kind === "branch") queue.unshift(...(conditionHolds(step.condition, values) ? step.yes : step.no));
    if (step.kind === "end") return { steps: reached, stoppedAt: null, outcome: step.outcome };
  }
  return { steps: reached, stoppedAt: null, outcome: null };
}

// ---- Words ----

export const END_REASONS: Record<EndReason, string> = {
  caller_hung_up: "Caller hung up",
  agent_ended: "Agent ended the call",
  transferred: "Passed to a person",
  no_answer: "No answer",
  voicemail: "Went to voicemail",
};

export const CALL_ACTIONS: Record<string, string> = {
  booked: "Booked",
  transferred: "Transferred",
  texted: "Sent a text",
  crm: "Updated CRM",
  message: "Took a message",
};

/** The same reasons the Forktime dashboard offers, so feedback reads the same everywhere. */
export const FEEDBACK_REASONS: { key: FeedbackReason; label: string }[] = [
  { key: "misunderstood", label: "Misunderstood the caller" },
  { key: "wrong_info", label: "Gave wrong information" },
  { key: "booking_mistake", label: "Booking or order mistake" },
  { key: "talked_over", label: "Talked over the caller or was slow" },
  { key: "should_transfer", label: "Should have passed the call to us" },
  { key: "robotic", label: "Sounded robotic" },
  { key: "other", label: "Other" },
];

export const NOTE_MAX = 1000;
