import { collections } from "./db";
import type { DncEntry } from "./types";

// The do-not-call list. A number on it is never dialled again, whoever adds
// it to the queue. The agent adds a number when someone asks not to be called.

export async function listDnc(): Promise<DncEntry[]> {
  const { dnc } = await collections();
  return dnc.find({}).sort({ addedAt: -1 }).limit(1000).toArray();
}

export async function dncPhones(): Promise<Set<string>> {
  const { dnc } = await collections();
  const rows = await dnc.find({}, { projection: { phone: 1 } }).toArray();
  return new Set(rows.map((row) => row.phone));
}

export async function addDnc(phone: string, reason: string, sourceCallId: string | null = null, now = new Date()): Promise<void> {
  const { dnc } = await collections();
  await dnc.updateOne({ _id: phone }, { $setOnInsert: { _id: phone, phone, reason, addedAt: now, sourceCallId } }, { upsert: true });
}

export async function removeDnc(phone: string): Promise<boolean> {
  const { dnc } = await collections();
  return (await dnc.deleteOne({ _id: phone })).deletedCount === 1;
}
