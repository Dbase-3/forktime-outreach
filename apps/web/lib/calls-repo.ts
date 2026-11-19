import { randomUUID } from "node:crypto";
import { MongoServerError } from "mongodb";
import { collections } from "./db";
import type { Outcome } from "./outcomes";
import type { NumberEntry } from "./phone";
import type { Call, CallJson, CallStage, TranscriptLine, TranscriptLineJson, TranscriptRole } from "./types";

// Every read and write of calls and their transcripts.

const iso = (date: Date | null | undefined) => (date ? date.toISOString() : null);

export function toCallJson(call: Call): CallJson {
  const { active: _active, ...rest } = call;
  return {
    ...rest,
    notBefore: iso(call.notBefore),
    queuedAt: call.queuedAt.toISOString(),
    startedAt: iso(call.startedAt),
    answeredAt: iso(call.answeredAt),
    endedAt: iso(call.endedAt),
  };
}

export function toLineJson(line: TranscriptLine): TranscriptLineJson {
  return { ...line, at: line.at.toISOString() };
}

/** Add numbers to the end of the queue as one batch. */
export async function addCalls(entries: NumberEntry[], fromNumber: string, now = new Date()): Promise<Call[]> {
  if (!entries.length) return [];
  const { calls } = await collections();
  const last = await calls.find({}, { projection: { order: 1 } }).sort({ order: -1 }).limit(1).next();
  const firstOrder = (last?.order ?? 0) + 1;
  const batchId = randomUUID();
  const docs: Call[] = entries.map((entry, index) => ({
    _id: randomUUID(),
    batchId,
    phone: entry.phone,
    label: entry.label,
    status: "queued",
    stage: null,
    outcome: null,
    attempt: 1,
    order: firstOrder + index,
    fromNumber,
    roomName: null,
    notBefore: null,
    queuedAt: now,
    startedAt: null,
    answeredAt: null,
    endedAt: null,
    durationSec: null,
    summary: null,
    ownerReached: null,
    contactName: null,
    callbackTime: null,
    bookingSystem: null,
    interested: null,
    recording: null,
    error: null,
    simulated: false,
  }));
  await calls.insertMany(docs);
  return docs;
}

/** The calls for the screen: what is live first, then the queue in order, then the newest finished. */
export async function listCalls(limit = 200): Promise<Call[]> {
  const { calls } = await collections();
  const [open, done] = await Promise.all([
    calls.find({ status: { $in: ["dialing", "live", "queued"] } }).sort({ order: 1 }).limit(limit).toArray(),
    calls.find({ status: { $in: ["ended", "cancelled"] } }).sort({ endedAt: -1 }).limit(limit).toArray(),
  ]);
  const rank = (call: Call) => (call.status === "queued" ? 1 : 0);
  return [...open.sort((a, b) => rank(a) - rank(b) || a.order - b.order), ...done];
}

export async function getCall(id: string): Promise<Call | null> {
  const { calls } = await collections();
  return calls.findOne({ _id: id });
}

export async function getTranscript(callId: string): Promise<TranscriptLine[]> {
  const { transcripts } = await collections();
  return transcripts.find({ callId }).sort({ seq: 1 }).toArray();
}

export async function getActiveCall(): Promise<Call | null> {
  const { calls } = await collections();
  return calls.findOne({ active: true });
}

export async function getQueuedCalls(limit = 500): Promise<Call[]> {
  const { calls } = await collections();
  return calls.find({ status: "queued" }).sort({ order: 1 }).limit(limit).toArray();
}

/**
 * Take a queued call for dialling. False when it is no longer queued or
 * another call already holds the line (the unique index refuses a second).
 */
export async function claimForDial(id: string, patch: { roomName: string; simulated: boolean }, now = new Date()): Promise<Call | null> {
  const { calls } = await collections();
  try {
    return await calls.findOneAndUpdate(
      { _id: id, status: "queued" },
      {
        $set: {
          status: "dialing",
          active: true,
          startedAt: now,
          answeredAt: null,
          endedAt: null,
          stage: null,
          outcome: null,
          error: null,
          roomName: patch.roomName,
          simulated: patch.simulated,
          simStep: 0,
        },
      },
      { returnDocument: "after" },
    );
  } catch (err) {
    if (err instanceof MongoServerError && err.code === 11000) return null;
    throw err;
  }
}

export async function markAnswered(id: string, at = new Date()): Promise<void> {
  const { calls } = await collections();
  await calls.updateOne({ _id: id, status: "dialing" }, { $set: { status: "live", stage: "talking", answeredAt: at } });
}

export async function setStage(id: string, stage: CallStage): Promise<void> {
  const { calls } = await collections();
  await calls.updateOne({ _id: id, status: "live" }, { $set: { stage } });
}

export interface CallEnding {
  outcome: Outcome;
  summary?: string | null;
  ownerReached?: boolean | null;
  contactName?: string | null;
  callbackTime?: string | null;
  bookingSystem?: string | null;
  interested?: boolean | null;
  error?: string | null;
}

/** Close a call that is on the line. Returns it as it now stands, or null if it was not open. */
export async function endCall(id: string, ending: CallEnding, now = new Date()): Promise<Call | null> {
  const { calls } = await collections();
  const open = await calls.findOne({ _id: id, status: { $in: ["dialing", "live"] } });
  if (!open) return null;
  const talkedFrom = open.answeredAt;
  return calls.findOneAndUpdate(
    { _id: id, status: { $in: ["dialing", "live"] } },
    {
      $set: {
        status: "ended",
        stage: null,
        outcome: ending.outcome,
        endedAt: now,
        durationSec: talkedFrom ? Math.max(0, Math.round((now.getTime() - talkedFrom.getTime()) / 1000)) : null,
        summary: ending.summary ?? null,
        ownerReached: ending.ownerReached ?? null,
        contactName: ending.contactName ?? null,
        callbackTime: ending.callbackTime ?? null,
        bookingSystem: ending.bookingSystem ?? null,
        interested: ending.interested ?? null,
        error: ending.error ?? null,
      },
      $unset: { active: "" },
    },
    { returnDocument: "after" },
  );
}

/** Put an unanswered call back in the queue for another try. */
export async function requeueForRetry(id: string, notBefore: Date): Promise<void> {
  const { calls } = await collections();
  await calls.updateOne(
    { _id: id, status: "ended" },
    { $set: { status: "queued", notBefore, outcome: null, roomName: null, startedAt: null, endedAt: null }, $inc: { attempt: 1 } },
  );
}

/** Close a queued call without dialling it. */
export async function closeQueued(id: string, outcome: Outcome, status: "ended" | "cancelled", now = new Date()): Promise<boolean> {
  const { calls } = await collections();
  const result = await calls.updateOne({ _id: id, status: "queued" }, { $set: { status, outcome, endedAt: now } });
  return result.modifiedCount === 1;
}

export async function setRecording(id: string, recording: { url: string | null; durationSec: number | null }): Promise<void> {
  const { calls } = await collections();
  await calls.updateOne({ _id: id }, { $set: { recording } });
}

export async function setSimStep(id: string, simStep: number): Promise<void> {
  const { calls } = await collections();
  await calls.updateOne({ _id: id }, { $set: { simStep } });
}

/** Store one line of a call. A line sent twice (a retried post) is kept once. */
export async function appendTranscript(callId: string, line: { seq: number; role: TranscriptRole; text: string; at: Date }): Promise<void> {
  const { transcripts } = await collections();
  await transcripts.updateOne(
    { callId, seq: line.seq },
    { $setOnInsert: { _id: randomUUID(), callId, seq: line.seq, role: line.role, text: line.text, at: line.at } },
    { upsert: true },
  );
}

export async function nextTranscriptSeq(callId: string): Promise<number> {
  const { transcripts } = await collections();
  const last = await transcripts.find({ callId }, { projection: { seq: 1 } }).sort({ seq: -1 }).limit(1).next();
  return (last?.seq ?? 0) + 1;
}

export async function clearTranscript(callId: string): Promise<void> {
  const { transcripts } = await collections();
  await transcripts.deleteMany({ callId });
}
