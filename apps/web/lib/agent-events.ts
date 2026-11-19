import { z } from "zod";
import { appendTranscript, getCall, markAnswered, setRecording, setStage } from "./calls-repo";
import { AGENT_OUTCOMES, type Outcome } from "./outcomes";
import { advanceQueue, finishCall } from "./queue-runner";
import { getSettings } from "./settings";

// What the voice agent tells the app while a call runs. The agent holds no
// database connection: it posts these, and this file is the only writer.

const base = { callId: z.string().min(1), attempt: z.number().int().min(1).optional() };
const text = (max: number) => z.string().trim().max(max).nullish();

export const agentEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("answered"), ...base }),
  z.object({
    type: z.literal("transcript"),
    ...base,
    seq: z.number().int().min(1),
    role: z.enum(["agent", "callee", "system"]),
    text: z.string().trim().min(1).max(4000),
    at: z.string().datetime().optional(),
  }),
  z.object({ type: z.literal("stage"), ...base, stage: z.enum(["talking", "transferring", "with_rep"]) }),
  z.object({ type: z.literal("not_answered"), ...base, detail: text(300) }),
  z.object({
    type: z.literal("ended"),
    ...base,
    /** What the agent chose with its end_call tool; absent when the line just dropped. */
    outcome: z.enum(AGENT_OUTCOMES).nullish(),
    transferred: z.boolean().optional(),
    endReason: z.enum(["agent_ended", "callee_hung_up", "transferred", "time_limit", "error"]),
    summary: text(1200),
    ownerReached: z.boolean().nullish(),
    contactName: text(120),
    callbackTime: text(160),
    bookingSystem: text(120),
    interested: z.boolean().nullish(),
    error: text(500),
  }),
  z.object({ type: z.literal("recording"), ...base, url: z.string().url().nullable(), durationSec: z.number().min(0).nullish() }),
]);

export type AgentEvent = z.infer<typeof agentEventSchema>;

/** The outcome a call is filed under, from what the agent reported. Pure. */
export function outcomeOfEnding(event: Extract<AgentEvent, { type: "ended" }>): Outcome {
  if (event.transferred || event.endReason === "transferred") return "transferred";
  if (event.outcome) return event.outcome;
  if (event.endReason === "error") return "failed";
  return event.endReason === "callee_hung_up" ? "hung_up" : "other";
}

export type ApplyResult = { ok: true } | { ok: false; status: number; message: string };

export async function applyAgentEvent(event: AgentEvent, now = new Date()): Promise<ApplyResult> {
  const call = await getCall(event.callId);
  if (!call) return { ok: false, status: 404, message: "No such call" };
  // An event from an earlier try of the same number must not touch the current one.
  if (event.attempt != null && event.attempt !== call.attempt) return { ok: true };

  switch (event.type) {
    case "answered":
      await markAnswered(call._id, now);
      return { ok: true };
    case "transcript":
      await appendTranscript(call._id, { seq: event.seq, role: event.role, text: event.text, at: event.at ? new Date(event.at) : now });
      return { ok: true };
    case "stage":
      await setStage(call._id, event.stage);
      return { ok: true };
    case "recording":
      await setRecording(call._id, { url: event.url, durationSec: event.durationSec ?? null });
      return { ok: true };
    case "not_answered":
      await finishCall(call._id, { outcome: "no_answer", error: event.detail ?? null }, await getSettings(), now);
      break;
    case "ended":
      await finishCall(
        call._id,
        {
          outcome: outcomeOfEnding(event),
          summary: event.summary,
          ownerReached: event.ownerReached,
          contactName: event.contactName,
          callbackTime: event.callbackTime,
          bookingSystem: event.bookingSystem,
          interested: event.interested,
          error: event.error,
        },
        await getSettings(),
        now,
      );
      break;
  }
  // The line is free: start the next number without waiting for the screen.
  await advanceQueue(now);
  return { ok: true };
}
