import { describe, expect, it } from "vitest";
import { agentStats, callsPerDay, isWin, totals } from "@outreach/core/stats";
import { seedState } from "@/lib/seed";
import type { Call } from "@outreach/core/types";

const now = new Date("2026-11-26T15:00:00");
const call = (id: string, startedAt: string, outcome: string, over: Partial<Call> = {}): Call => ({
  id, contactId: "c", flowId: "f1", direction: "outbound", startedAt, durationSec: 60, outcome, summary: "", saved: {}, transcript: [], ...over,
});

describe("callsPerDay", () => {
  const calls = [
    call("a", "2026-11-26T10:00:00", "service_booked"),
    call("b", "2026-11-26T11:00:00", "not_now"),
    call("c", "2026-11-25T09:00:00", "no_answer"),
    call("d", "2026-11-10T09:00:00", "service_booked"), // outside a 7-day window
    call("e", "2026-11-26T14:59:00", "in_progress", { live: true }),
  ];

  it("buckets by local day, oldest first, ending today", () => {
    const points = callsPerDay(calls, 7, now);
    expect(points).toHaveLength(7);
    expect(points.at(-1)).toMatchObject({ calls: 2, wins: 1 });
    expect(points.at(-2)).toMatchObject({ calls: 1, wins: 0 });
    expect(totals(points)).toEqual({ calls: 3, wins: 1 });
  });

  it("skips live calls and calls outside the window", () => {
    expect(totals(callsPerDay(calls, 30, now)).calls).toBe(4);
  });
});

describe("agentStats", () => {
  it("counts live, today, the week, answer rate and average length", () => {
    const calls = [
      call("a", "2026-11-26T10:00:00", "service_booked", { durationSec: 100 }),
      call("b", "2026-11-24T10:00:00", "no_answer", { durationSec: 0 }),
      call("c", "2026-11-23T10:00:00", "not_now", { durationSec: 50 }),
      call("d", "2026-11-26T14:59:00", "in_progress", { live: true }),
      call("x", "2026-11-26T10:00:00", "service_booked", { flowId: "other" }),
    ];
    expect(agentStats({ id: "f1" }, calls, now)).toEqual({
      liveNow: 1, today: 1, week: 3, answerRate: 2 / 3, avgSec: 75, lastCallAt: "2026-11-26T10:00:00",
    });
  });

  it("has nothing to average for an agent with no calls", () => {
    expect(agentStats({ id: "none" }, [], now)).toMatchObject({ week: 0, answerRate: null, avgSec: null, lastCallAt: null });
  });
});

describe("outcomes and sample data", () => {
  it("knows which outcomes are wins", () => {
    expect(["service_booked", "appointment_set", "transferred", "message_taken"].every(isWin)).toBe(true);
    expect(["not_now", "no_answer", "needs_decision_maker"].some(isWin)).toBe(false);
  });

  it("the sample has two weeks of calls, one of them live, and the same calls every time", () => {
    const a = seedState(now);
    const b = seedState(now);
    expect(a.calls.filter((c) => c.live)).toHaveLength(1);
    expect(totals(callsPerDay(a.calls, 14, now)).calls).toBeGreaterThan(50);
    expect(a.calls.map((c) => c.id)).toEqual(b.calls.map((c) => c.id));
  });
});
