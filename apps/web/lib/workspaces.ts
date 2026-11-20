import { randomUUID } from "node:crypto";
import { collections } from "./db";
import type { Workspace } from "./types";

/** The existing Forktime data is kept here during the multi-workspace upgrade. */
export const DEFAULT_WORKSPACE_ID = "forktime";

function cleanName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

export async function ensureDefaultWorkspace(): Promise<Workspace> {
  const { workspaces } = await collections();
  const now = new Date();
  await workspaces.updateOne(
    { _id: DEFAULT_WORKSPACE_ID },
    { $setOnInsert: { _id: DEFAULT_WORKSPACE_ID, name: "Forktime", createdAt: now, updatedAt: now } },
    { upsert: true },
  );
  return (await workspaces.findOne({ _id: DEFAULT_WORKSPACE_ID })) as Workspace;
}

export async function listWorkspaces(): Promise<Workspace[]> {
  await ensureDefaultWorkspace();
  const { workspaces } = await collections();
  return workspaces.find({}).sort({ createdAt: 1 }).toArray();
}

export async function getWorkspace(id: string): Promise<Workspace | null> {
  if (id === DEFAULT_WORKSPACE_ID) await ensureDefaultWorkspace();
  const { workspaces } = await collections();
  return workspaces.findOne({ _id: id });
}

/** Resolve the workspace query parameter used by the admin UI. */
export async function workspaceFromRequest(request: Request): Promise<string | null> {
  const id = new URL(request.url).searchParams.get("workspace") || DEFAULT_WORKSPACE_ID;
  return (await getWorkspace(id)) ? id : null;
}

export async function createWorkspace(name: string): Promise<Workspace> {
  const value = cleanName(name);
  if (!value || value.length > 80) throw new Error("Give the workspace a name of up to 80 characters.");
  const now = new Date();
  const workspace: Workspace = { _id: randomUUID(), name: value, createdAt: now, updatedAt: now };
  const { workspaces } = await collections();
  await workspaces.insertOne(workspace);
  return workspace;
}

/** Legacy Forktime records have no workspaceId; they belong to the default workspace. */
export function workspaceFilter(workspaceId: string): Record<string, unknown> {
  return workspaceId === DEFAULT_WORKSPACE_ID
    ? { $or: [{ workspaceId }, { workspaceId: { $exists: false } }] }
    : { workspaceId };
}

export async function workspaceForCalledNumber(phone: string): Promise<string> {
  const { settings } = await collections();
  const found = await settings.findOne({ $or: [{ fromNumber: phone }, { callbackNumber: phone }] }, { projection: { _id: 1, workspaceId: 1 } });
  if (!found || found._id === "app") return DEFAULT_WORKSPACE_ID;
  return found.workspaceId ?? found._id;
}
