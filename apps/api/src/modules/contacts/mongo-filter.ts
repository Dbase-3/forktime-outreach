// The rules engine (@outreach/core conditions: "purchase date is more than 30
// days ago", "tier is any of Gold, Platinum") as a MongoDB query, so filtering
// 100k+ contacts happens in the database with indexes, not in the browser.
// Values are stored typed (typed-fields.ts). Semantics follow core `holds`;
// test/mongo-filter.test.ts checks both give the same contacts. "Today" is the
// workspace's own day.

import type { Condition, ConditionGroup, FieldType } from "@outreach/core/types";
import type { FilterQuery } from "mongoose";

type Q = FilterQuery<Record<string, unknown>>;

const BUILT_IN_PATH: Record<string, string> = { name: "name", phone: "phone", email: "email", lists: "groups", created: "createdAt", last_call: "lastCallAt", last_outcome: "lastOutcome" };
const DATE_INSTANT = new Set(["createdAt", "lastCallAt"]); // stored as real Dates, not "YYYY-MM-DD"

export function pathOf(key: string): string {
  return BUILT_IN_PATH[key] ?? `fields.${key}`;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const num = (v: string | undefined): number | null => {
  if (v === undefined || v.trim() === "") return null;
  const n = Number(v.replace(/[,$\s]/g, ""));
  return Number.isNaN(n) ? null : n;
};
const list = (v: string | undefined) => (v ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);

/** "YYYY-MM-DD" for a date shifted by `days` from `iso`. */
function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

/** Today's date in a time zone, as "YYYY-MM-DD". */
export function todayIn(timezone: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** The instant a day starts in a time zone ("2026-11-26" in Sydney → 2026-11-25T13:00Z). */
export function dayStart(iso: string, timezone: string): Date {
  const guess = new Date(`${iso}T00:00:00Z`);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: timezone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(guess).map((p) => [p.type, p.value]));
  const asLocal = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
  return new Date(guess.getTime() - (asLocal - guess.getTime()));
}

function isoDay(v: string | undefined): string | null {
  const m = (v ?? "").trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

const EMPTY: Q = { $in: [null, ""] };
const ISO_LIKE = /^\d{4}-\d{2}-\d{2}/;

/** One rule as a MongoDB condition. */
export function ruleQuery(rule: Condition, type: FieldType, ctx: { timezone: string; now?: Date }): Q {
  const path = pathOf(rule.field);
  const isList = path === "groups";
  const target = (rule.value ?? "").trim();
  const lower = target.toLowerCase();
  const { op } = rule;
  const today = todayIn(ctx.timezone, ctx.now);

  if (isList) {
    const anyOf = (items: string[]) => ({ groups: { $in: items.map((i) => new RegExp(`^${esc(i)}$`, "i")) } });
    if (op === "is_set") return { groups: { $exists: true, $ne: [] } };
    if (op === "is_empty") return { $or: [{ groups: { $exists: false } }, { groups: { $size: 0 } }] };
    if (op === "is" || op === "any_of") return anyOf(op === "is" ? [lower] : list(rule.value));
    if (op === "is_not" || op === "none_of") return { $nor: [anyOf(op === "is_not" ? [lower] : list(rule.value))] };
    if (op === "contains") return { groups: new RegExp(esc(target), "i") };
    if (op === "not_contains") return { $nor: [{ groups: new RegExp(esc(target), "i") }] };
    if (op === "starts_with") return { groups: new RegExp(`^${esc(target)}`, "i") };
    return { _id: null }; // other checks don't apply to lists
  }

  if (op === "is_set") return { [path]: { $nin: [null, ""] } };
  if (op === "is_empty") return { [path]: EMPTY };
  if (op === "is_yes") return { [path]: { $in: [true, 1, /^(yes|y|true|1)$/i] } };
  if (op === "is_no") return { [path]: { $in: [false, 0, /^(no|n|false|0)$/i] } };

  const equals = (): Q => {
    const n = num(target);
    const opts: unknown[] = [new RegExp(`^${esc(target)}$`, "i")];
    if (n !== null) opts.push(n);
    return { [path]: { $in: opts } };
  };
  if (op === "is") return target === "" ? { _id: null } : equals();
  if (op === "is_not") return target === "" ? { [path]: { $nin: [null, ""] } } : { $nor: [equals()] };
  if (op === "contains") return { [path]: new RegExp(esc(target), "i") };
  if (op === "not_contains") return target === "" ? { _id: null } : { $nor: [{ [path]: new RegExp(esc(target), "i") }] };
  if (op === "starts_with") return { [path]: new RegExp(`^${esc(target)}`, "i") };
  const anyOf = (): Q => ({ [path]: { $in: list(rule.value).flatMap((v) => (num(v) !== null ? [new RegExp(`^${esc(v)}$`, "i"), num(v) as number] : [new RegExp(`^${esc(v)}$`, "i")])) } });
  if (op === "any_of") return anyOf();
  if (op === "none_of") return { $nor: [anyOf()] };

  // Numbers
  const isNumberOp = op === "more_than" || op === "less_than" || op === "at_least" || op === "at_most" || (op === "between" && num(rule.value) !== null && num(rule.value2) !== null && type !== "date");
  if (isNumberOp) {
    const b = num(rule.value);
    if (b === null) return { _id: null };
    let range: Record<string, number>;
    if (op === "more_than") range = { $gt: b };
    else if (op === "less_than") range = { $lt: b };
    else if (op === "at_least") range = { $gte: b };
    else if (op === "at_most") range = { $lte: b };
    else {
      const c = num(rule.value2) as number;
      range = { $gte: Math.min(b, c), $lte: Math.max(b, c) };
    }
    if (type === "number") return { [path]: range };
    // A number check on a text field: compare the text as a number where it is one.
    const asNum = { $convert: { input: { $replaceAll: { input: { $toString: { $ifNull: [`$${path}`, ""] } }, find: ",", replacement: "" } }, to: "double", onError: null, onNull: null } };
    const parts = Object.entries(range).map(([k, v]) => ({ [k]: [asNum, v] }));
    return { $expr: { $and: [{ $ne: [asNum, null] }, ...parts] } };
  }

  // Dates: compare whole days. Custom date fields are "YYYY-MM-DD" text; created / last call are instants.
  const dayRange = (from: string | null, to: string | null, fromOpen = false, toOpen = false): Q => {
    if (DATE_INSTANT.has(path)) {
      const r: Record<string, Date> = {};
      if (from) r[fromOpen ? "$gte" : "$gte"] = dayStart(fromOpen ? addDays(from, 1) : from, ctx.timezone);
      if (to) r[toOpen ? "$lt" : "$lt"] = dayStart(toOpen ? to : addDays(to, 1), ctx.timezone);
      return { [path]: r };
    }
    const r: Record<string, unknown> = { $regex: ISO_LIKE };
    if (from) r[fromOpen ? "$gt" : "$gte"] = fromOpen ? `${from}￿` : from;
    if (to) r[toOpen ? "$lt" : "$lte"] = toOpen ? to : `${to}￿`;
    return { [path]: r };
  };
  if (op === "before" || op === "after" || op === "on" || op === "between") {
    const a = isoDay(rule.value);
    if (!a) return { _id: null };
    if (op === "before") return dayRange(null, a, false, true);
    if (op === "after") return dayRange(a, null, true, false);
    if (op === "on") return dayRange(a, a);
    const b = isoDay(rule.value2);
    if (!b) return { _id: null };
    return a <= b ? dayRange(a, b) : dayRange(b, a);
  }
  const days = num(rule.value);
  if (days === null) return { _id: null };
  // diff = (day - today) in days; negative = in the past (as core holds).
  if (op === "less_than_days_ago") return dayRange(addDays(today, -(Math.ceil(days) - 1)), today); // -days < diff <= 0
  if (op === "more_than_days_ago") return dayRange(null, addDays(today, -Math.floor(days)), false, true); // diff < -days
  if (op === "less_than_days_from_now") return dayRange(today, addDays(today, Math.ceil(days) - 1)); // 0 <= diff < days
  if (op === "more_than_days_from_now") return dayRange(addDays(today, Math.floor(days)), null, true, false); // diff > days
  return { _id: null };
}

/** A whole And/Or group. An empty group matches everyone. */
export function groupQuery(group: ConditionGroup, typeOf: (key: string) => FieldType, ctx: { timezone: string; now?: Date }): Q {
  if (!group.rules.length) return {};
  const parts = group.rules.map((r) => ruleQuery(r, typeOf(r.field), ctx));
  return group.match === "all" ? { $and: parts } : { $or: parts };
}
