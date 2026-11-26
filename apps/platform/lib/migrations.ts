// What happens to a saved workspace when the app's data version moves on.
// Before: any change of SEED_VERSION replaced the visitor's whole workspace
// with the sample (bug B1). Now:
//   - a workspace nobody edited is simply replaced by the fresh sample;
//   - an edited one is kept: explicit migrations run for versions that need
//     them, then anything new in the data model is filled in from defaults.
// Rule for the future: bumping SEED_VERSION with a non-additive change means
// adding a step to MIGRATIONS. Pure, tested.

import type { AppState, Flow } from "@outreach/core/types";

/** Explicit steps: MIGRATIONS[n] turns a version-n workspace into version n+1. */
export const MIGRATIONS: Record<number, (s: AppState) => AppState> = {};

const FLOW_DEFAULTS: Partial<Flow> = { prompt: "", tools: [], knowledgeIds: [], dataFields: [], askRequired: {}, checks: [] };

/** Adds any collection or agent field the saved workspace predates, without touching what's there. */
export function fillDefaults(saved: AppState, fresh: AppState): AppState {
  const out = { ...saved } as AppState & Record<string, unknown>;
  for (const [key, value] of Object.entries(fresh)) {
    if (out[key] === undefined) out[key] = Array.isArray(value) ? [] : value;
  }
  out.settings = { ...fresh.settings, ...saved.settings };
  out.flows = (saved.flows ?? []).map((f) => {
    const flow = { ...f } as Flow & Record<string, unknown>;
    for (const [key, value] of Object.entries(FLOW_DEFAULTS)) if (flow[key] === undefined) flow[key] = structuredClone(value);
    flow.timezone ||= saved.settings?.timezone || "UTC";
    return flow;
  });
  return out;
}

/**
 * The workspace to use, or null to start from the fresh sample.
 * `fresh` is the current sample (for defaults and for untouched workspaces).
 */
export function migrateState(saved: AppState | null, current: number, fresh: () => AppState): AppState | null {
  if (!saved || typeof saved !== "object" || typeof saved.version !== "number") return null;
  if (saved.version === current) return saved;
  if (!saved.edited) return null; // never touched: take the newer sample
  let next = saved;
  for (let v = saved.version; v < current; v++) {
    const step = MIGRATIONS[v];
    if (step) next = step(next);
  }
  return { ...fillDefaults(next, fresh()), version: current };
}

/** A document left "reading" by a closed tab (bug B17) gets marked failed so it can be tried again. */
export function repairStuck(s: AppState, now = Date.now()): AppState {
  const stale = s.knowledge.some((d) => d.status === "reading" && now - new Date(d.updatedAt).getTime() > 120_000);
  if (!stale) return s;
  return {
    ...s,
    knowledge: s.knowledge.map((d) => (d.status === "reading" && now - new Date(d.updatedAt).getTime() > 120_000 ? { ...d, status: "failed", error: "Reading stopped before it finished. Try again." } : d)),
  };
}
