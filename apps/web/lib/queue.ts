import { insideCallingWindow, type CallingWindow } from "./calling-window";

// The dialler's decisions, as plain functions: what to do next with the queue,
// and when a call that stopped reporting is given up on. The runner
// (queue-runner.ts) reads the database, asks these, and acts.

export interface QueuedCandidate {
  _id: string;
  phone: string;
  notBefore: Date | null;
}

export type QueuePlan =
  | { type: "wait"; reason: "paused" | "line_busy" | "empty" | "outside_window" | "retry_pending" }
  | { type: "skip"; callId: string; reason: "do_not_call" }
  | { type: "dial"; callId: string };

/**
 * One call at a time, in the order the numbers were added. A number on the
 * do-not-call list is skipped, and nothing is dialled outside the window.
 */
export function planNext(input: {
  now: Date;
  running: boolean;
  lineBusy: boolean;
  /** Queued calls, oldest first. */
  queued: QueuedCandidate[];
  doNotCall: ReadonlySet<string>;
  window: CallingWindow;
}): QueuePlan {
  if (!input.running) return { type: "wait", reason: "paused" };
  if (input.lineBusy) return { type: "wait", reason: "line_busy" };
  if (!input.queued.length) return { type: "wait", reason: "empty" };

  const blocked = input.queued.find((call) => input.doNotCall.has(call.phone));
  if (blocked) return { type: "skip", callId: blocked._id, reason: "do_not_call" };

  if (!insideCallingWindow(input.now, input.window)) return { type: "wait", reason: "outside_window" };

  const due = input.queued.find((call) => !call.notBefore || call.notBefore.getTime() <= input.now.getTime());
  return due ? { type: "dial", callId: due._id } : { type: "wait", reason: "retry_pending" };
}

/** Seconds past the ring time before a call that never connected is closed. */
export const DIAL_GRACE_SEC = 45;
/** Minutes past the call limit before a live call that went quiet is closed. */
export const LIVE_GRACE_MIN = 3;

export interface ActiveCallClock {
  status: "dialing" | "live";
  startedAt: Date | null;
  answeredAt: Date | null;
}

/**
 * A call the agent stopped reporting on (worker down, room gone). Without
 * this the line would stay "busy" and the queue would never move again.
 */
export function staleVerdict(
  call: ActiveCallClock,
  now: Date,
  limits: { ringTimeoutSec: number; maxCallMinutes: number },
): { outcome: "no_answer" | "failed"; error: string } | null {
  const since = (from: Date | null) => (from ? (now.getTime() - from.getTime()) / 1000 : Infinity);
  if (call.status === "dialing" && since(call.startedAt) > limits.ringTimeoutSec + DIAL_GRACE_SEC) {
    return { outcome: "failed", error: "The voice agent never reported on this call. Is the agent running?" };
  }
  if (call.status === "live" && since(call.answeredAt ?? call.startedAt) > (limits.maxCallMinutes + LIVE_GRACE_MIN) * 60) {
    return { outcome: "failed", error: "The call ran past its limit without an ending from the agent." };
  }
  return null;
}

/** Whether a call that ended this way goes back in the queue, and when. */
export function retryPlan(input: {
  outcome: string;
  attempt: number;
  maxAttempts: number;
  retryAfterMinutes: number;
  now: Date;
  retryable: readonly string[];
}): { notBefore: Date } | null {
  if (!input.retryable.includes(input.outcome)) return null;
  if (input.attempt >= input.maxAttempts) return null;
  return { notBefore: new Date(input.now.getTime() + input.retryAfterMinutes * 60_000) };
}
