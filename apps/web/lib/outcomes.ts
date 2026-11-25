// How a call ended. The agent picks from AGENT_OUTCOMES (its end_call tool);
// the system sets the rest. apps/agent/src/outcomes.js mirrors the first list
// and tests/outcomes-contract.test.ts fails if the two drift.

export const AGENT_OUTCOMES = [
  "owner_callback",
  "not_interested",
  "message_left",
  "call_back_later",
  "refused",
  "not_a_fit",
  "voicemail",
  "phone_menu",
  "wrong_number",
  "do_not_call",
  "other",
  // The Forkmate line (inbound callers we never rang).
  "forkmate_booking",
  "forkmate_venue",
] as const;

export const SYSTEM_OUTCOMES = [
  "transferred",
  "no_answer",
  "hung_up",
  "failed",
  "cancelled",
  "skipped_do_not_call",
] as const;

export type AgentOutcome = (typeof AGENT_OUTCOMES)[number];
export type SystemOutcome = (typeof SYSTEM_OUTCOMES)[number];
export type Outcome = AgentOutcome | SystemOutcome;

export const ALL_OUTCOMES: readonly Outcome[] = [...AGENT_OUTCOMES, ...SYSTEM_OUTCOMES];

type Tone = "good" | "neutral" | "warn" | "bad";

export const OUTCOME_INFO: Record<Outcome, { label: string; tone: Tone }> = {
  transferred: { label: "Connected to rep", tone: "good" },
  owner_callback: { label: "Owner wants a call back", tone: "good" },
  message_left: { label: "Message left for owner", tone: "neutral" },
  call_back_later: { label: "Call back at a better time", tone: "neutral" },
  not_interested: { label: "Not interested", tone: "warn" },
  not_a_fit: { label: "Booking unavailable", tone: "neutral" },
  refused: { label: "Staff would not pass it on", tone: "warn" },
  voicemail: { label: "Voicemail", tone: "neutral" },
  phone_menu: { label: "Phone menu or AI answered", tone: "neutral" },
  wrong_number: { label: "Wrong number", tone: "warn" },
  do_not_call: { label: "Asked not to be called", tone: "bad" },
  other: { label: "Other", tone: "neutral" },
  forkmate_booking: { label: "Forkmate booking request", tone: "good" },
  forkmate_venue: { label: "Forkmate venue listing", tone: "good" },
  no_answer: { label: "No answer", tone: "neutral" },
  hung_up: { label: "Hung up early", tone: "warn" },
  failed: { label: "Call failed", tone: "bad" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  skipped_do_not_call: { label: "Skipped: on the do-not-call list", tone: "neutral" },
};

/** Worth another try later: nobody picked up, so nothing was said. */
export const RETRYABLE_OUTCOMES: readonly Outcome[] = ["no_answer"];

export function isOutcome(value: unknown): value is Outcome {
  return typeof value === "string" && (ALL_OUTCOMES as readonly string[]).includes(value);
}
