import { describe, expect, it } from "vitest";
import { migrateState, repairStuck } from "@/lib/migrations";
import { SEED_VERSION, seedState } from "@/lib/seed";
import type { AppState } from "@/lib/types";

const fresh = () => seedState(new Date(2026, 10, 26));

describe("a newer data version (bug B1)", () => {
  it("keeps the current version as it is", () => {
    const s = { ...fresh(), edited: true };
    expect(migrateState(s, SEED_VERSION, fresh)).toBe(s);
  });

  it("replaces a sample nobody touched with the newer sample", () => {
    const old = { ...fresh(), version: SEED_VERSION - 1 };
    expect(migrateState(old, SEED_VERSION, fresh)).toBeNull();
  });

  it("keeps edited work and fills in what the old version didn't have", () => {
    const base = fresh();
    const old = {
      ...base,
      version: SEED_VERSION - 3,
      edited: true,
      flows: base.flows.map((f, i) => (i === 0 ? ({ ...f, name: "My own agent", prompt: undefined, tools: undefined, timezone: undefined } as never) : f)),
    } as AppState & Record<string, unknown>;
    delete (old as Record<string, unknown>).numbers;
    const kept = migrateState(old, SEED_VERSION, fresh) as AppState;
    expect(kept.version).toBe(SEED_VERSION);
    expect(kept.flows[0].name).toBe("My own agent");
    expect(kept.flows[0].prompt).toBe("");
    expect(kept.flows[0].tools).toEqual([]);
    expect(kept.flows[0].timezone).toBe(base.settings.timezone);
    expect(kept.numbers).toEqual([]);
    expect(kept.contacts.length).toBe(base.contacts.length);
  });

  it("ignores something that isn't a workspace", () => {
    expect(migrateState(null, SEED_VERSION, fresh)).toBeNull();
    expect(migrateState({ hello: 1 } as never, SEED_VERSION, fresh)).toBeNull();
  });
});

describe("documents stuck reading (bug B17)", () => {
  it("marks old ones failed so they can be tried again, leaves fresh ones alone", () => {
    const s = fresh();
    const now = Date.now();
    const stuck = { ...s, knowledge: [{ ...s.knowledge[0], status: "reading" as const, updatedAt: new Date(now - 10 * 60_000).toISOString() }, { ...s.knowledge[1], status: "reading" as const, updatedAt: new Date(now - 5_000).toISOString() }] };
    const fixed = repairStuck(stuck, now);
    expect(fixed.knowledge[0].status).toBe("failed");
    expect(fixed.knowledge[1].status).toBe("reading");
    expect(repairStuck(s, now)).toBe(s);
  });
});
