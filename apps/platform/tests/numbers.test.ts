import { describe, expect, it } from "vitest";
import { COUNTRIES, availableNumbers, freeNumbers, numberOwner, randomAgentName } from "@outreach/core/numbers";
import { seedState } from "@/lib/seed";

describe("one agent per number", () => {
  const flows = [
    { id: "f1", name: "Front desk", numberId: "n1" },
    { id: "f2", name: "Sales", numberId: undefined },
  ];
  const numbers = [
    { id: "n1", e164: "+61255501234", display: "(02) 5550 1234", country: "AU", kind: "local" as const, addedAt: "" },
    { id: "n2", e164: "+61491570156", display: "0491 570 156", country: "AU", kind: "mobile" as const, addedAt: "" },
  ];

  it("knows who owns a number, ignoring the agent being edited", () => {
    expect(numberOwner(flows, "n1")?.name).toBe("Front desk");
    expect(numberOwner(flows, "n1", "f1")).toBeUndefined();
    expect(numberOwner(flows, "n2")).toBeUndefined();
    expect(numberOwner(flows, undefined)).toBeUndefined();
  });

  it("lists the free ones", () => {
    expect(freeNumbers(numbers, flows).map((n) => n.id)).toEqual(["n2"]);
    expect(freeNumbers(numbers, flows, "f1").map((n) => n.id)).toEqual(["n1", "n2"]);
  });

  it("the sample gives each agent its own number and leaves one spare", () => {
    const state = seedState(new Date(2026, 10, 26));
    const used = state.flows.map((f) => f.numberId).filter(Boolean);
    expect(new Set(used).size).toBe(used.length);
    expect(freeNumbers(state.numbers, state.flows)).toHaveLength(1);
  });
});

describe("getting another number", () => {
  it("offers fresh numbers in every country, type and area, never one we have", () => {
    for (const c of COUNTRIES) {
      for (const kind of c.kinds) {
        const offers = availableNumbers(c.code, kind, c.areas[0].id, []);
        expect(offers).toHaveLength(5);
        expect(new Set(offers.map((o) => o.e164)).size).toBe(5);
        expect(offers.every((o) => o.e164.startsWith("+"))).toBe(true);
      }
    }
    const first = availableNumbers("AU", "local", "2", []);
    const again = availableNumbers("AU", "local", "2", [first[0].e164]);
    expect(again.map((o) => o.e164)).not.toContain(first[0].e164);
  });

  it("starter names are friendly and not already taken", () => {
    const seq = [0, 0, 0, 0, 0.5, 0.5];
    let i = 0;
    const rand = () => seq[i++ % seq.length];
    expect(randomAgentName(["Bright Falcon"], rand)).not.toBe("Bright Falcon");
    expect(randomAgentName([])).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
  });
});
