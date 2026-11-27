"use client";

// The workspace, now from the API (Phase 1). Pages still read it with useApp()
// and edit with update(): the screen changes at once, and edits to agents,
// campaigns, settings, knowledge names and field labels are saved in the
// background (debounced, with the version they were made on). If someone else
// saved first, the item is reloaded from the server and the banner says so.
// Creating, deleting, publishing and starting go through lib/actions.ts.
// Contacts and calls are not held here: they're paged from the server.

import { useSyncExternalStore } from "react";
import { AgentDraftSchema, CampaignInputSchema } from "@outreach/core/schemas";
import type { AppState, Campaign, Flow, KnowledgeDoc } from "@outreach/core/types";
import { ApiError, request, setWorkspace, ws } from "./api";

export interface WorkspaceInfo {
  id: string;
  name: string;
  role: "owner" | "admin" | "member";
  version: number;
}

export type Loaded = AppState & { workspace: WorkspaceInfo; counts: { contacts: number; calls: number } };

type Status = { phase: "loading" } | { phase: "signed_out" } | { phase: "no_workspace" } | { phase: "ready" } | { phase: "error"; message: string };

const listeners = new Set<() => void>();
let state: Loaded | null = null;
let status: Status = { phase: "loading" };
let saveProblem: string | null = null;
let saving = 0;

const empty: Loaded = {
  version: 0,
  flows: [],
  numbers: [],
  knowledge: [],
  contacts: [],
  fieldDefs: [],
  sources: [],
  campaigns: [],
  calls: [],
  integrations: [],
  settings: { businessName: "", phoneNumber: "", inboundFlowId: "", timezone: "Australia/Sydney", callingDays: [1, 2, 3, 4, 5], callingStart: 9, callingEnd: 19, doNotCall: [] },
  workspace: { id: "", name: "", role: "member", version: 0 },
  counts: { contacts: 0, calls: 0 },
};

function notify(): void {
  listeners.forEach((l) => l());
}

// ---- Loading ----

const WS_KEY = "forktime.workspace";
type Me = { user: { id: string; email: string; name: string }; workspaces: { id: string; name: string; role: string }[] };
let meCache: Me | null = null;

export function me(): Me | null {
  return meCache;
}

export async function boot(preferred?: string): Promise<void> {
  status = { phase: "loading" };
  notify();
  try {
    meCache = await request<Me>("/me");
    if (!meCache.workspaces.length) {
      status = { phase: "no_workspace" };
      return notify();
    }
    let saved: string | null = null;
    try {
      saved = window.localStorage.getItem(WS_KEY);
    } catch {
      // storage blocked: use the first workspace
    }
    const chosen = meCache.workspaces.find((w) => w.id === (preferred ?? saved)) ?? meCache.workspaces[0];
    await loadWorkspace(chosen.id);
  } catch (err) {
    status = err instanceof ApiError && err.status === 401 ? { phase: "signed_out" } : { phase: "error", message: err instanceof Error ? err.message : "Couldn't load the workspace." };
    notify();
  }
}

export async function loadWorkspace(id: string): Promise<void> {
  setWorkspace(id);
  try {
    window.localStorage.setItem(WS_KEY, id);
  } catch {
    // fine
  }
  type Boot = Omit<Loaded, "contacts" | "calls" | "settings" | "version" | "workspace"> & { workspace: WorkspaceInfo & { settings: Omit<AppState["settings"], "phoneNumber" | "inboundFlowId"> } };
  const b = await ws<Boot>("/bootstrap");
  const { settings, ...workspace } = b.workspace;
  state = { ...empty, ...b, workspace, settings: { ...empty.settings, ...settings }, contacts: [], calls: [], version: 0 };
  status = { phase: "ready" };
  notify();
}

export function getState(): Loaded | null {
  return state;
}

/** Replace part of the state without saving (after an API call returned the truth). */
export function patchState(fn: (s: Loaded) => Loaded): void {
  if (!state) return;
  state = fn(state);
  notify();
}

// ---- Editing with background saves ----

type Key = string; // "flow:<id>", "campaign:<id>", "settings", "knowledge:<id>", "field:<key>"
const timers = new Map<Key, ReturnType<typeof setTimeout>>();
const DRAFT_KEYS = Object.keys(AgentDraftSchema.shape) as (keyof Flow)[];
const CONFIG_KEYS = Object.keys(CampaignInputSchema.shape) as (keyof Campaign)[];
const pick = <T extends object>(o: T, keys: (keyof T)[]) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function update(fn: (current: Loaded) => Loaded): void {
  if (!state) return;
  const prev = state;
  const next = fn(prev);
  state = next;
  notify();
  for (const f of next.flows) {
    const was = prev.flows.find((x) => x.id === f.id);
    if (was && !same(pick(was, DRAFT_KEYS), pick(f, DRAFT_KEYS))) schedule(`flow:${f.id}`);
  }
  for (const c of next.campaigns) {
    const was = prev.campaigns.find((x) => x.id === c.id);
    if (was && !same(pick(was, CONFIG_KEYS), pick(c, CONFIG_KEYS))) schedule(`campaign:${c.id}`);
  }
  if (!same(prev.settings, next.settings)) schedule("settings");
  for (const k of next.knowledge) {
    const was = prev.knowledge.find((x) => x.id === k.id);
    if (was && (was.name !== k.name || was.availableToAll !== k.availableToAll || was.autoRefresh !== k.autoRefresh)) schedule(`knowledge:${k.id}`);
  }
  for (const d of next.fieldDefs) {
    const was = prev.fieldDefs.find((x) => x.key === d.key);
    if (was && was.label !== d.label) schedule(`field:${d.key}`);
  }
}

function schedule(key: Key): void {
  clearTimeout(timers.get(key));
  timers.set(key, setTimeout(() => void save(key), 600));
  notify();
}

const versionOf = (o: unknown) => (o as { version?: number }).version ?? 1;

/** What the owner calls the part of an agent a rejected save points at ("prompt" → "Instructions: "). */
const PART_NAMES: Record<string, string> = {
  name: "Name", description: "Description", brief: "Description for Write with AI", greeting: "Welcome message", prompt: "Instructions",
  steps: "A workflow step", dataFields: "Data to collect", checks: "Success checks", tools: "Tools", afterCall: "After the call", agent: "Voice",
};
function partName(path?: string): string {
  const first = (path ?? "").split(".")[0];
  return PART_NAMES[first] ? `${PART_NAMES[first]}: ` : "";
}

async function save(key: Key): Promise<void> {
  timers.delete(key);
  if (!state) return;
  const [kind, id] = key.split(/:(.*)/s);
  saving++;
  notify();
  try {
    if (kind === "flow") {
      const f = state.flows.find((x) => x.id === id);
      if (!f) return;
      const out = await ws<Flow & { version: number }>(`/agents/${id}`, { method: "PATCH", body: { version: versionOf(f), draft: pick(f, DRAFT_KEYS) } });
      patchState((s) => ({ ...s, flows: s.flows.map((x) => (x.id === id ? ({ ...x, version: out.version, updatedAt: out.updatedAt } as Flow) : x)) }));
    } else if (kind === "campaign") {
      const c = state.campaigns.find((x) => x.id === id);
      if (!c) return;
      const out = await ws<Campaign & { version: number }>(`/campaigns/${id}`, { method: "PATCH", body: { version: versionOf(c), ...pick(c, CONFIG_KEYS) } });
      patchState((s) => ({ ...s, campaigns: s.campaigns.map((x) => (x.id === id ? ({ ...x, version: out.version } as Campaign) : x)) }));
    } else if (kind === "settings") {
      const { phoneNumber: _p, inboundFlowId: _i, ...settings } = state.settings;
      const out = await ws<{ version: number }>("/settings", { method: "PATCH", body: { version: state.workspace.version, settings } });
      patchState((s) => ({ ...s, workspace: { ...s.workspace, version: out.version, name: settings.businessName } }));
    } else if (kind === "knowledge") {
      const k = state.knowledge.find((x) => x.id === id);
      if (!k) return;
      const out = await ws<KnowledgeDoc & { version: number }>(`/knowledge/${id}`, { method: "PATCH", body: { version: versionOf(k), name: k.name, availableToAll: k.availableToAll, ...(k.autoRefresh === undefined ? {} : { autoRefresh: k.autoRefresh }) } });
      patchState((s) => ({ ...s, knowledge: s.knowledge.map((x) => (x.id === id ? ({ ...x, version: out.version } as KnowledgeDoc) : x)) }));
    } else if (kind === "field") {
      const d = state.fieldDefs.find((x) => x.key === id);
      if (d) await ws(`/fields/${id}`, { method: "PATCH", body: { label: d.label } });
    }
    saveProblem = null;
  } catch (err) {
    // A rejected save names the part it's about ("Instructions: Too big…"), so the owner knows what to shorten.
    if (err instanceof ApiError && err.code === "stale") {
      // Someone else saved first: take theirs.
      const current = (err.details as { current?: unknown } | undefined)?.current;
      if (current) {
        if (kind === "flow") patchState((s) => ({ ...s, flows: s.flows.map((x) => (x.id === id ? (current as Flow) : x)) }));
        if (kind === "campaign") patchState((s) => ({ ...s, campaigns: s.campaigns.map((x) => (x.id === id ? (current as Campaign) : x)) }));
        if (kind === "knowledge") patchState((s) => ({ ...s, knowledge: s.knowledge.map((x) => (x.id === id ? (current as KnowledgeDoc) : x)) }));
        if (kind === "settings") {
          const c = current as { settings: AppState["settings"]; version: number };
          patchState((s) => ({ ...s, settings: { ...s.settings, ...c.settings }, workspace: { ...s.workspace, version: c.version } }));
        }
      }
      saveProblem = "Someone else changed this just now, so it's been reloaded with their version.";
    } else {
      const detail = err instanceof ApiError && Array.isArray(err.details) ? ` ${(err.details as { path?: string; message: string }[]).map((d) => `${partName(d.path)}${d.message}`).join(" ")}` : "";
      saveProblem = `Couldn't save: ${err instanceof Error ? err.message : "unknown problem"}${detail}`;
    }
  } finally {
    saving--;
    notify();
  }
}

/** Saves anything still waiting (before leaving the page or switching workspace). */
export async function flush(): Promise<void> {
  const keys = [...timers.keys()];
  keys.forEach((k) => clearTimeout(timers.get(k)));
  await Promise.all(keys.map((k) => save(k)));
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", (e) => {
    if (timers.size || saving) {
      void flush();
      e.preventDefault();
    }
  });
}

// ---- Hooks ----

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The loaded workspace. Only used under <Shell>, which waits for it. */
export function useApp(): Loaded {
  return useSyncExternalStore(subscribe, () => state ?? empty, () => empty);
}

export function useStatus(): Status {
  return useSyncExternalStore(subscribe, () => status, () => status);
}

/** Why the last save failed (or was reloaded), or null. */
export function useSaveProblem(): string | null {
  return useSyncExternalStore(subscribe, () => saveProblem, () => null);
}

export function useSaving(): boolean {
  return useSyncExternalStore(subscribe, () => saving > 0 || timers.size > 0, () => false);
}

export function dismissSaveProblem(): void {
  saveProblem = null;
  notify();
}

export function nowIso(): string {
  return new Date().toISOString();
}
