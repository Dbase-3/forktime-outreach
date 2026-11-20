import {
  claimForDial,
  closeQueued,
  endCall,
  getActiveCall,
  getQueuedCalls,
  requeueForRetry,
  type CallEnding,
} from "./calls-repo";
import { closeRoom, placeCall, roomNameFor } from "./dialer";
import { addDnc, dncPhones } from "./dnc";
import { env } from "./env";
import { RETRYABLE_OUTCOMES } from "./outcomes";
import { planNext, retryPlan, staleVerdict, type QueuePlan } from "./queue";
import { getQueueState, getSettings, setQueueRunning } from "./settings";
import { advanceSimulation } from "./simulate";
import type { Call, Settings } from "./types";
import { DEFAULT_WORKSPACE_ID } from "./workspaces";

// Moves the queue: closes a call that went quiet, then starts the next one.
// Safe to call from anywhere and as often as you like (the screen calls it
// every few seconds, and the agent's "call ended" does too): the database
// allows one call on the line, so two callers can never start two calls.

type WaitReason = Extract<QueuePlan, { type: "wait" }>["reason"];

export interface QueueSnapshot {
  running: boolean;
  waiting: WaitReason | null;
  activeCallId: string | null;
  queued: number;
  mode: "live" | "dry";
}

/**
 * Everything that follows a call ending, whoever ended it: the do-not-call
 * list, and another try later for a call nobody answered.
 */
export async function finishCall(
  id: string,
  ending: CallEnding,
  settings: Settings,
  now = new Date(),
  workspaceId = DEFAULT_WORKSPACE_ID,
): Promise<Call | null> {
  const ended = await endCall(id, ending, now);
  if (!ended) return null;
  if (ending.outcome === "do_not_call") {
    await addDnc(ended.phone, "Asked not to be called", ended._id, now, workspaceId);
    return ended;
  }
  const retry = retryPlan({
    outcome: ending.outcome,
    attempt: ended.attempt,
    maxAttempts: settings.maxAttempts,
    retryAfterMinutes: settings.retryAfterMinutes,
    now,
    retryable: RETRYABLE_OUTCOMES,
  });
  if (retry) await requeueForRetry(ended._id, retry.notBefore);
  return ended;
}

/** Look after the call on the line. Returns true when the line is free afterwards. */
async function tendActiveCall(active: Call, settings: Settings, now: Date, workspaceId: string): Promise<boolean> {
  if (active.simulated) return advanceSimulation(active, settings, now);
  if (active.status !== "dialing" && active.status !== "live") return false;
  const stale = staleVerdict(
    { status: active.status, startedAt: active.startedAt, answeredAt: active.answeredAt },
    now,
    { ringTimeoutSec: settings.ringTimeoutSec, maxCallMinutes: settings.maxCallMinutes },
  );
  if (!stale) return false;
  if (active.roomName) await closeRoom(active.roomName).catch(() => undefined);
  await finishCall(active._id, { outcome: stale.outcome, error: stale.error }, settings, now, workspaceId);
  return true;
}

async function startCall(callId: string, queued: Call[], settings: Settings, now: Date, workspaceId: string): Promise<void> {
  const call = queued.find((c) => c._id === callId);
  if (!call) return;
  const mode = env.dialMode();
  const claimed = await claimForDial(call._id, { roomName: roomNameFor(call), simulated: mode === "dry" }, now);
  if (!claimed || mode === "dry") return;
  try {
    await placeCall(claimed, settings, claimed.roomName ?? roomNameFor(claimed));
  } catch (err) {
    await finishCall(claimed._id, { outcome: "failed", error: `The call could not be placed: ${(err as Error).message}` }, settings, now, workspaceId);
  }
}

export async function advanceQueue(now = new Date(), workspaceId = DEFAULT_WORKSPACE_ID): Promise<QueueSnapshot> {
  const settings = await getSettings(workspaceId);
  let waiting: WaitReason | null = null;

  // Each pass handles one thing (a skip, a failed dial); a handful is plenty.
  for (let pass = 0; pass < 25; pass += 1) {
    const [{ running }, active, queued, doNotCall] = await Promise.all([
      getQueueState(workspaceId),
      getActiveCall(workspaceId),
      getQueuedCalls(500, workspaceId),
      dncPhones(workspaceId),
    ]);
    if (active && (await tendActiveCall(active, settings, now, workspaceId))) continue;

    const plan = planNext({
      now,
      running,
      lineBusy: !!active,
      queued: queued.map((c) => ({ _id: c._id, phone: c.phone, notBefore: c.notBefore })),
      doNotCall,
      // Calling hours protect restaurants from a ringing phone; a dry run rings nobody.
      window: env.dialMode() === "dry" ? { ...settings, enforceWindow: false } : settings,
    });

    if (plan.type === "skip") {
      await closeQueued(plan.callId, "skipped_do_not_call", "ended", now);
      continue;
    }
    if (plan.type === "dial") {
      await startCall(plan.callId, queued, settings, now, workspaceId);
      continue;
    }
    // The queue ran dry: stop, so numbers added later wait for a fresh Start.
    if (plan.reason === "empty" && running) await setQueueRunning(false, workspaceId);
    waiting = plan.reason;
    break;
  }

  const [{ running }, active, queued] = await Promise.all([getQueueState(workspaceId), getActiveCall(workspaceId), getQueuedCalls(500, workspaceId)]);
  return { running, waiting, activeCallId: active?._id ?? null, queued: queued.length, mode: env.dialMode() };
}
