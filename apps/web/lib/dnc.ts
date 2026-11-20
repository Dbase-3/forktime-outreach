import { collections } from "./db";
import type { DncEntry } from "./types";
import { DEFAULT_WORKSPACE_ID, workspaceFilter } from "./workspaces";

// The do-not-call list. A number on it is never dialled again, whoever adds
// it to the queue. The agent adds a number when someone asks not to be called.

export async function listDnc(workspaceId = DEFAULT_WORKSPACE_ID): Promise<DncEntry[]> {
  const { dnc } = await collections();
  return dnc.find(workspaceFilter(workspaceId)).sort({ addedAt: -1 }).limit(1000).toArray();
}

export async function dncPhones(workspaceId = DEFAULT_WORKSPACE_ID): Promise<Set<string>> {
  const { dnc } = await collections();
  const rows = await dnc.find(workspaceFilter(workspaceId), { projection: { phone: 1 } }).toArray();
  return new Set(rows.map((row) => row.phone));
}

export async function addDnc(
  phone: string,
  reason: string,
  sourceCallId: string | null = null,
  now = new Date(),
  workspaceId = DEFAULT_WORKSPACE_ID,
): Promise<void> {
  const { dnc } = await collections();
  const _id = `${workspaceId}:${phone}`;
  await dnc.updateOne({ _id }, { $setOnInsert: { _id, workspaceId, phone, reason, addedAt: now, sourceCallId } }, { upsert: true });
}

export async function removeDnc(phone: string, workspaceId = DEFAULT_WORKSPACE_ID): Promise<boolean> {
  const { dnc } = await collections();
  if (workspaceId === DEFAULT_WORKSPACE_ID) {
    return (await dnc.deleteOne({ $or: [{ _id: `${workspaceId}:${phone}` }, { _id: phone }] })).deletedCount === 1;
  }
  return (await dnc.deleteOne({ _id: `${workspaceId}:${phone}` })).deletedCount === 1;
}
