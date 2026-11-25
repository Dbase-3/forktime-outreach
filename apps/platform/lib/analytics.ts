// Numbers for the Analytics page (owner 2026-11-26, after Dialora's): filters,
// headline figures with the change from the period before, pickup, inbound vs
// outbound, per agent, lead quality, engagement, mood, transfers, and the best
// time to call in each region's own local time. Pure.

import { isWin } from "./stats";
import type { Call, Contact, Flow } from "./types";

const DAY = 24 * 60 * 60 * 1000;

// ---- Range and filters ----

export type RangeId = "today" | "7d" | "30d" | "90d" | "ytd";

export const RANGES: { id: RangeId; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "7d", label: "Last 7 days" },
  { id: "30d", label: "Last 30 days" },
  { id: "90d", label: "Last 90 days" },
  { id: "ytd", label: "Year to date" },
];

export interface Bounds {
  from: number;
  to: number;
  prevFrom: number;
  prevTo: number;
}

function startOfDay(t: number): number {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** The range, and the same length just before it (for "vs previous period"). */
export function rangeBounds(range: RangeId, now: Date): Bounds {
  const to = now.getTime();
  const today = startOfDay(to);
  const from =
    range === "today" ? today
    : range === "7d" ? today - 6 * DAY
    : range === "30d" ? today - 29 * DAY
    : range === "90d" ? today - 89 * DAY
    : new Date(now.getFullYear(), 0, 1).getTime();
  const length = to - from;
  return { from, to, prevFrom: from - length, prevTo: from };
}

export interface CallFilter {
  flowId?: string;
  direction?: "inbound" | "outbound";
  language?: string;
}

/** Finished calls in [from, to) matching the filter. Live calls are counted once they end. */
export function pickCalls(calls: Call[], flows: Flow[], from: number, to: number, filter: CallFilter = {}): Call[] {
  const language = new Map(flows.map((f) => [f.id, f.agent.language]));
  return calls.filter((c) => {
    if (c.live) return false;
    const t = new Date(c.startedAt).getTime();
    if (t < from || t >= to) return false;
    if (filter.flowId && c.flowId !== filter.flowId) return false;
    if (filter.direction && c.direction !== filter.direction) return false;
    if (filter.language && language.get(c.flowId) !== filter.language) return false;
    return true;
  });
}

// ---- Pickup ----

export type Pickup = "answered" | "voicemail" | "no_answer" | "busy" | "failed";

export const PICKUP_LABEL: Record<Pickup, string> = {
  answered: "Answered",
  voicemail: "Voicemail",
  no_answer: "No answer",
  busy: "Busy",
  failed: "Didn't connect",
};
export const PICKUPS: Pickup[] = ["answered", "voicemail", "no_answer", "busy", "failed"];

/** How a call went at the start. Someone calling us always counts as answered. */
export function pickupOf(call: Call): Pickup {
  if (call.direction === "inbound") return "answered";
  if (call.endReason === "voicemail" || call.outcome === "voicemail") return "voicemail";
  if (call.endReason === "busy" || call.outcome === "busy") return "busy";
  if (call.endReason === "failed" || call.outcome === "failed") return "failed";
  if (call.endReason === "no_answer" || call.outcome === "no_answer") return "no_answer";
  return "answered";
}

export function pickupBreakdown(calls: Call[]): { counts: Record<Pickup, number>; total: number; rate: number | null } {
  const counts = Object.fromEntries(PICKUPS.map((p) => [p, 0])) as Record<Pickup, number>;
  const outbound = calls.filter((c) => c.direction === "outbound");
  outbound.forEach((c) => counts[pickupOf(c)]++);
  return { counts, total: outbound.length, rate: outbound.length ? counts.answered / outbound.length : null };
}

// ---- Headline figures ----

export interface Summary {
  calls: number;
  answered: number;
  answerRate: number | null; // calls we made that were picked up
  avgSec: number | null; // answered calls
  talkSec: number; // minutes the team didn't spend on the phone
  wins: number;
  winRate: number | null; // answered calls that did their job
  transfers: number;
  transferRate: number | null;
  inbound: number;
  outbound: number;
}

const ratio = (a: number, b: number) => (b ? a / b : null);

export function summarize(calls: Call[]): Summary {
  const talked = calls.filter((c) => pickupOf(c) === "answered");
  const outbound = calls.filter((c) => c.direction === "outbound");
  const talkSec = talked.reduce((sum, c) => sum + c.durationSec, 0);
  const wins = talked.filter((c) => isWin(c.outcome)).length;
  const transfers = talked.filter((c) => c.transferTo || c.endReason === "transferred").length;
  return {
    calls: calls.length,
    answered: talked.length,
    answerRate: ratio(outbound.filter((c) => pickupOf(c) === "answered").length, outbound.length),
    avgSec: talked.length ? Math.round(talkSec / talked.length) : null,
    talkSec,
    wins,
    winRate: ratio(wins, talked.length),
    transfers,
    transferRate: ratio(transfers, talked.length),
    inbound: calls.length - outbound.length,
    outbound: outbound.length,
  };
}

/** Change from the previous period: relative for counts, points for rates. Null when there's nothing to compare. */
export function change(now: number | null, before: number | null, kind: "count" | "rate"): number | null {
  if (now === null || before === null) return null;
  if (kind === "rate") return now - before;
  return before === 0 ? null : (now - before) / before;
}

// ---- Over time ----

export interface Bucket {
  start: number;
  label: string; // tooltip heading
  tick: string; // axis label
  calls: number;
  answered: number;
  wins: number;
}

/** Hours for a single day, days up to ~4 months, weeks beyond. */
export function timeline(calls: Call[], from: number, to: number): Bucket[] {
  const span = to - from;
  const unit = span <= DAY + 1000 ? "hour" : span <= 120 * DAY ? "day" : "week";
  const step = unit === "hour" ? DAY / 24 : unit === "day" ? DAY : 7 * DAY;
  const buckets: Bucket[] = [];
  for (let t = from; t < to; t += step) {
    const d = new Date(t);
    const label =
      unit === "hour" ? d.toLocaleTimeString("en-AU", { hour: "numeric" })
      : unit === "day" ? d.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" })
      : `Week of ${d.toLocaleDateString("en-AU", { day: "numeric", month: "short" })}`;
    const tick = unit === "hour" ? d.toLocaleTimeString("en-AU", { hour: "numeric" }).replace(" ", "") : d.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
    buckets.push({ start: t, label, tick, calls: 0, answered: 0, wins: 0 });
  }
  for (const c of calls) {
    const i = Math.floor((new Date(c.startedAt).getTime() - from) / step);
    const b = buckets[i];
    if (!b) continue;
    b.calls++;
    if (pickupOf(c) === "answered") b.answered++;
    if (isWin(c.outcome)) b.wins++;
  }
  return buckets;
}

// ---- Per agent ----

export interface AgentRow {
  flow: Flow;
  summary: Summary;
  trend: number[]; // calls per bucket
}

export function byAgent(calls: Call[], flows: Flow[], from: number, to: number): AgentRow[] {
  return flows
    .map((flow) => {
      const mine = calls.filter((c) => c.flowId === flow.id);
      return { flow, summary: summarize(mine), trend: timeline(mine, from, to).map((b) => b.calls) };
    })
    .filter((r) => r.summary.calls > 0)
    .sort((a, b) => b.summary.calls - a.summary.calls);
}

// ---- Inbound vs outbound ----

export function directions(calls: Call[]) {
  const inbound = calls.filter((c) => c.direction === "inbound");
  const outbound = calls.filter((c) => c.direction === "outbound");
  const handled = inbound.filter((c) => !c.transferTo && c.endReason !== "transferred");
  return {
    inbound: { calls: inbound.length, avgSec: summarize(inbound).avgSec, handledRate: ratio(handled.length, inbound.length) },
    outbound: { calls: outbound.length, avgSec: summarize(outbound).avgSec, pickupRate: pickupBreakdown(outbound).rate },
  };
}

// ---- How the conversation went (answered calls that were judged) ----

export const LEAD_TIERS = [
  { id: "qualified", label: "Qualified", hint: "Strong interest or ready to buy" },
  { id: "potential", label: "Potential", hint: "Some interest, needs a follow-up" },
  { id: "unqualified", label: "Not a lead", hint: "No clear interest or not relevant" },
] as const;

export const ENGAGEMENT_TIERS = [
  { id: "high", label: "High", hint: "Talked freely and asked questions" },
  { id: "medium", label: "Medium", hint: "Listened and gave short answers" },
  { id: "low", label: "Low", hint: "Passive or keen to get off" },
] as const;

export const MOOD_TIERS = [
  { id: "calm", label: "Calm", hint: "Relaxed the whole call" },
  { id: "neutral", label: "Neutral", hint: "Some tension at moments" },
  { id: "upset", label: "Upset", hint: "Frustrated or annoyed" },
] as const;

export type Tally = { id: string; count: number; share: number }[];

function tally(ids: readonly string[], values: string[]): { rows: Tally; total: number } {
  const total = values.length;
  return { rows: ids.map((id) => { const count = values.filter((v) => v === id).length; return { id, count, share: total ? count / total : 0 }; }), total };
}

export function moodOf(call: Call): "calm" | "neutral" | "upset" | null {
  if (!call.mood?.length) return null;
  const avg = call.mood.reduce((a, b) => a + b, 0) / call.mood.length;
  return avg < 0.25 ? "calm" : avg > 0.5 ? "upset" : "neutral";
}

export function conversation(calls: Call[]) {
  const talked = calls.filter((c) => pickupOf(c) === "answered");
  return {
    leads: tally(LEAD_TIERS.map((t) => t.id), talked.flatMap((c) => (c.lead ? [c.lead] : []))),
    engagement: tally(ENGAGEMENT_TIERS.map((t) => t.id), talked.flatMap((c) => (c.engagement ? [c.engagement] : []))),
    mood: tally(MOOD_TIERS.map((t) => t.id), talked.flatMap((c) => { const m = moodOf(c); return m ? [m] : []; })),
  };
}

export function transfers(calls: Call[]) {
  const talked = calls.filter((c) => pickupOf(c) === "answered");
  const toPerson = talked.filter((c) => c.transferTo === "person" || (!c.transferTo && c.endReason === "transferred")).length;
  const toAgent = talked.filter((c) => c.transferTo === "agent").length;
  return { toPerson, toAgent, total: toPerson + toAgent, rate: ratio(toPerson + toAgent, talked.length), answered: talked.length };
}

export function topOutcomes(calls: Call[], limit = 6): { outcome: string; count: number; share: number }[] {
  const talked = calls.filter((c) => pickupOf(c) === "answered");
  const counts = new Map<string, number>();
  talked.forEach((c) => counts.set(c.outcome, (counts.get(c.outcome) ?? 0) + 1));
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([outcome, count]) => ({ outcome, count, share: count / talked.length }));
}

// ---- Best time to call, in the contact's own local time ----

export interface Region {
  id: string;
  label: string;
  timezone: string;
}

const REGIONS: (Region & { prefix: string })[] = [
  { prefix: "+61", id: "AU", label: "Australia", timezone: "Australia/Sydney" },
  { prefix: "+64", id: "NZ", label: "New Zealand", timezone: "Pacific/Auckland" },
  { prefix: "+44", id: "GB", label: "United Kingdom", timezone: "Europe/London" },
  { prefix: "+91", id: "IN", label: "India", timezone: "Asia/Kolkata" },
  { prefix: "+92", id: "PK", label: "Pakistan", timezone: "Asia/Karachi" },
  { prefix: "+1", id: "NA", label: "US and Canada", timezone: "America/New_York" },
];

export function regionOf(phone: string | undefined, fallbackZone: string): Region {
  const clean = (phone ?? "").replace(/[^\d+]/g, "");
  const hit = REGIONS.find((r) => clean.startsWith(r.prefix));
  return hit ? { id: hit.id, label: hit.label, timezone: hit.timezone } : { id: "other", label: "Elsewhere", timezone: fallbackZone };
}

export const WINDOWS = [8, 10, 12, 14, 16, 18] as const; // two-hour windows starting at these hours
export const WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
export const MIN_REGION_CALLS = 10;
export const MIN_CELL_CALLS = 3;

export function windowLabel(start: number): string {
  const h = (x: number) => (x === 12 ? "12pm" : x > 12 ? `${x - 12}pm` : `${x}am`);
  return `${h(start)}–${h(start + 2)}`;
}

/** Day of week (0 = Mon) and hour where the call landed. */
export function localSlot(iso: string, timezone: string): { day: number; hour: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short", hour: "numeric", hourCycle: "h23" }).formatToParts(new Date(iso));
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
  return { day: Math.max(0, WEEK.indexOf(weekday as (typeof WEEK)[number])), hour };
}

export interface Cell {
  day: number;
  window: number; // index into WINDOWS
  calls: number;
  hits: number;
  rate: number | null; // null below MIN_CELL_CALLS
}

export type TimeMetric = "pickup" | "goal";

export function bestTimes(calls: Call[], contacts: Contact[], fallbackZone: string, metric: TimeMetric) {
  const phone = new Map(contacts.map((c) => [c.id, c.phone]));
  const outbound = calls.filter((c) => c.direction === "outbound");
  const regions = new Map<string, { region: Region; calls: Call[] }>();
  for (const call of outbound) {
    const region = regionOf(phone.get(call.contactId), fallbackZone);
    const entry = regions.get(region.id) ?? { region, calls: [] };
    entry.calls.push(call);
    regions.set(region.id, entry);
  }
  return [...regions.values()]
    .sort((a, b) => b.calls.length - a.calls.length)
    .map(({ region, calls: list }) => {
      const cells: Cell[] = WEEK.flatMap((_, day) => WINDOWS.map((__, window) => ({ day, window, calls: 0, hits: 0, rate: null as number | null })));
      for (const call of list) {
        const { day, hour } = localSlot(call.startedAt, region.timezone);
        const window = WINDOWS.findIndex((w) => hour >= w && hour < w + 2);
        if (window < 0) continue;
        const cell = cells[day * WINDOWS.length + window];
        cell.calls++;
        const hit = metric === "pickup" ? pickupOf(call) === "answered" : isWin(call.outcome);
        if (hit) cell.hits++;
      }
      cells.forEach((c) => (c.rate = c.calls >= MIN_CELL_CALLS ? c.hits / c.calls : null));
      // Rank on a smoothed rate, so 5 of 5 doesn't beat 18 of 20 on luck alone.
      const score = (c: Cell) => (c.hits + 1) / (c.calls + 2);
      const top = cells.filter((c) => c.rate !== null).sort((a, b) => score(b) - score(a) || b.calls - a.calls).slice(0, 3);
      return { region, calls: list.length, enough: list.length >= MIN_REGION_CALLS, cells, top };
    });
}

// ---- Export ----

function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function callsCsv(calls: Call[], flows: Flow[], contacts: Contact[]): string {
  const flow = new Map(flows.map((f) => [f.id, f.name]));
  const contact = new Map(contacts.map((c) => [c.id, c]));
  const head = ["Started", "Agent", "Direction", "Contact", "Phone", "Pickup", "Outcome", "Seconds", "Lead", "Engagement", "Mood", "Transfer"];
  const rows = calls.map((c) => [
    c.startedAt,
    flow.get(c.flowId) ?? "",
    c.direction,
    contact.get(c.contactId)?.name ?? "",
    contact.get(c.contactId)?.phone ?? "",
    PICKUP_LABEL[pickupOf(c)],
    c.outcome,
    c.durationSec,
    c.lead ?? "",
    c.engagement ?? "",
    moodOf(c) ?? "",
    c.transferTo ?? (c.endReason === "transferred" ? "person" : ""),
  ]);
  return [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
}
