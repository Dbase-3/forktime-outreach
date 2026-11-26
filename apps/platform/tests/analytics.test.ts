import { describe, expect, it } from "vitest";
import {
  bestTimes,
  byAgent,
  callsCsv,
  change,
  conversation,
  localSlot,
  pickCalls,
  pickupBreakdown,
  pickupOf,
  rangeBounds,
  regionOf,
  summarize,
  timeline,
  transfers,
} from "@/lib/analytics";
import { seedState } from "@/lib/seed";
import type { Call, Contact } from "@/lib/types";

const call = (over: Partial<Call>): Call => ({
  id: Math.random().toString(36),
  contactId: "c1",
  flowId: "f1",
  direction: "outbound",
  startedAt: "2026-11-24T00:00:00.000Z",
  durationSec: 60,
  outcome: "meeting_booked",
  summary: "",
  saved: {},
  transcript: [],
  ...over,
});

describe("pickup", () => {
  it("reads how each call started; calls to us always count as answered", () => {
    expect(pickupOf(call({ endReason: "voicemail", outcome: "voicemail" }))).toBe("voicemail");
    expect(pickupOf(call({ outcome: "no_answer" }))).toBe("no_answer");
    expect(pickupOf(call({ endReason: "busy" }))).toBe("busy");
    expect(pickupOf(call({ direction: "inbound", outcome: "no_answer" }))).toBe("answered");
    const b = pickupBreakdown([call({}), call({ outcome: "no_answer" }), call({ direction: "inbound" })]);
    expect(b.total).toBe(2);
    expect(b.rate).toBe(0.5);
  });
});

describe("headline figures", () => {
  it("rates come from the right base", () => {
    const s = summarize([
      call({ durationSec: 100 }),
      call({ outcome: "not_now", durationSec: 50 }),
      call({ outcome: "no_answer", durationSec: 0 }),
      call({ direction: "inbound", outcome: "transferred", endReason: "transferred", durationSec: 30 }),
    ]);
    expect(s.calls).toBe(4);
    expect(s.answerRate).toBeCloseTo(2 / 3);
    expect(s.avgSec).toBe(60);
    expect(s.talkSec).toBe(180);
    expect(s.winRate).toBeCloseTo(2 / 3); // booked + transferred, of 3 answered
    expect(s.transferRate).toBeCloseTo(1 / 3);
  });

  it("change: relative for counts, points for rates, none without a base", () => {
    expect(change(12, 10, "count")).toBeCloseTo(0.2);
    expect(change(0.7, 0.6, "rate")).toBeCloseTo(0.1);
    expect(change(5, 0, "count")).toBeNull();
    expect(change(null, 0.5, "rate")).toBeNull();
  });
});

describe("ranges and filters", () => {
  it("the previous period is the same stretch one period earlier", () => {
    const now = new Date(2026, 10, 26, 15, 0);
    const b = rangeBounds("7d", now);
    expect(new Date(b.prevFrom)).toEqual(new Date(2026, 10, 13));
    expect(new Date(b.prevTo)).toEqual(new Date(2026, 10, 19, 15, 0));
    expect(b.to - b.from).toBe(b.prevTo - b.prevFrom);
    expect(new Date(rangeBounds("ytd", now).from).getMonth()).toBe(0);
  });

  it("filters by agent, direction and the agent's language, and skips live calls", () => {
    const flows = [{ id: "f1", agent: { language: "English" } }, { id: "f2", agent: { language: "Spanish" } }] as never;
    const list = [call({}), call({ flowId: "f2" }), call({ live: true }), call({ direction: "inbound" })];
    const t = new Date("2026-11-24T00:00:00.000Z").getTime();
    expect(pickCalls(list, flows, t, t + 1).length).toBe(3);
    expect(pickCalls(list, flows, t, t + 1, { language: "Spanish" }).length).toBe(1);
    expect(pickCalls(list, flows, t, t + 1, { direction: "inbound" }).length).toBe(1);
  });

  it("a single day is drawn by the hour, a long range by the week", () => {
    const now = new Date(2026, 10, 26, 15, 0);
    const today = rangeBounds("today", now);
    expect(timeline([], today.from, today.to)).toHaveLength(15);
    const ytd = rangeBounds("ytd", now);
    expect(timeline([], ytd.from, ytd.to).length).toBeLessThan(60);
  });
});

describe("best time to call", () => {
  it("places a call in the contact's own local time", () => {
    // 23:00 UTC on Mon 23 Nov = 10:00 Tue in Sydney (UTC+11).
    expect(localSlot("2026-11-23T23:00:00.000Z", "Australia/Sydney")).toEqual({ day: 1, hour: 10 });
    expect(regionOf("+64 21 555 0101", "UTC").id).toBe("NZ");
    expect(regionOf("0412 555 019", "Australia/Sydney")).toMatchObject({ id: "other", timezone: "Australia/Sydney" });
  });

  it("ranks windows only once they have enough calls", () => {
    const contacts = [{ id: "c1", phone: "+61412555019" }] as Contact[];
    const at = "2026-11-23T23:00:00.000Z"; // Tue 10am Sydney
    const list = [call({ startedAt: at }), call({ startedAt: at }), call({ startedAt: at, outcome: "no_answer" }), call({ startedAt: "2026-11-24T03:00:00.000Z" })];
    const [au] = bestTimes(list, contacts, "UTC", "pickup");
    expect(au.region.id).toBe("AU");
    expect(au.enough).toBe(false);
    expect(au.top).toHaveLength(1);
    expect(au.top[0]).toMatchObject({ day: 1, window: 1, calls: 3, hits: 2 });
  });
});

describe("ranking windows", () => {
  it("a bigger sample beats a lucky small one", () => {
    const contacts = [{ id: "c1", phone: "+61412555019" }] as Contact[];
    const tue10 = "2026-11-23T23:00:00.000Z"; // Tue 10am Sydney
    const wed10 = "2026-11-24T23:00:00.000Z"; // Wed 10am Sydney
    const list = [
      ...Array.from({ length: 3 }, () => call({ startedAt: tue10 })),
      ...Array.from({ length: 19 }, () => call({ startedAt: wed10 })),
      call({ startedAt: wed10, outcome: "no_answer" }),
    ];
    const [au] = bestTimes(list, contacts, "UTC", "pickup");
    expect(au.top[0]).toMatchObject({ day: 2, calls: 20, hits: 19 });
  });
});

describe("the sample workspace", () => {
  it("has enough history to fill every section", () => {
    const state = seedState(new Date(2026, 10, 26, 15, 0));
    const b = rangeBounds("30d", new Date(2026, 10, 26, 15, 0));
    const calls = pickCalls(state.calls, state.flows, b.from, b.to);
    expect(calls.length).toBeGreaterThan(150);
    expect(pickCalls(state.calls, state.flows, b.prevFrom, b.prevTo).length).toBeGreaterThan(100);
    const pickup = pickupBreakdown(calls);
    expect(pickup.counts.voicemail + pickup.counts.no_answer + pickup.counts.busy).toBeGreaterThan(0);
    const conv = conversation(calls);
    expect(conv.leads.total).toBeGreaterThan(50);
    expect(conv.engagement.total).toBeGreaterThan(50);
    expect(conv.mood.total).toBeGreaterThan(50);
    expect(transfers(calls).total).toBeGreaterThan(0);
    const regions = bestTimes(calls, state.contacts, state.settings.timezone, "pickup");
    expect(regions.map((r) => r.region.id)).toEqual(expect.arrayContaining(["AU", "NZ"]));
    expect(regions.find((r) => r.region.id === "AU")?.enough).toBe(true);
    expect(byAgent(calls, state.flows, b.from, b.to).length).toBe(3);
    expect(callsCsv(calls.slice(0, 2), state.flows, state.contacts).split("\n")).toHaveLength(3);
  });
});

describe("comparison periods (B12) and one meaning of answered (B10)", () => {
  it("today so far compares with yesterday up to the same time; ytd with last year", () => {
    const now = new Date(2026, 10, 26, 10, 0);
    const t = rangeBounds("today", now);
    expect(new Date(t.prevFrom)).toEqual(new Date(2026, 10, 25, 0, 0));
    expect(new Date(t.prevTo)).toEqual(new Date(2026, 10, 25, 10, 0));
    const y = rangeBounds("ytd", now);
    expect(new Date(y.prevFrom)).toEqual(new Date(2025, 0, 1));
    expect(new Date(y.prevTo)).toEqual(new Date(2025, 10, 26, 10, 0));
  });

  it("Home and Analytics agree that voicemail and busy aren't answered", async () => {
    const { answered } = await import("@/lib/stats");
    expect(answered(call({ endReason: "voicemail", outcome: "voicemail" }))).toBe(false);
    expect(answered(call({ endReason: "busy", outcome: "busy" }))).toBe(false);
    expect(answered(call({}))).toBe(true);
  });
});
