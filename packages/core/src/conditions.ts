// One rule engine for every place a condition appears: a decision inside an
// agent, a campaign's audience, a campaign trigger. The operators on offer
// depend on the field's type, the way HubSpot and Airtable filters work.
// Pure: `now` is passed in.

import type { Condition, ConditionGroup, ConditionOp, FieldType } from "./types";

const DAY = 24 * 60 * 60 * 1000;

interface OpInfo {
  label: string;
  /** What the value box asks for: nothing, one value, two values (between), or a number of days. */
  input: "none" | "value" | "range" | "days" | "list";
}

export const OPS: Record<ConditionOp, OpInfo> = {
  is: { label: "is", input: "value" },
  is_not: { label: "is not", input: "value" },
  contains: { label: "contains", input: "value" },
  not_contains: { label: "doesn't contain", input: "value" },
  starts_with: { label: "starts with", input: "value" },
  more_than: { label: "is more than", input: "value" },
  less_than: { label: "is less than", input: "value" },
  at_least: { label: "is at least", input: "value" },
  at_most: { label: "is at most", input: "value" },
  between: { label: "is between", input: "range" },
  before: { label: "is before", input: "value" },
  after: { label: "is after", input: "value" },
  on: { label: "is on", input: "value" },
  less_than_days_ago: { label: "is less than … days ago", input: "days" },
  more_than_days_ago: { label: "is more than … days ago", input: "days" },
  less_than_days_from_now: { label: "is less than … days from now", input: "days" },
  more_than_days_from_now: { label: "is more than … days from now", input: "days" },
  any_of: { label: "is any of", input: "list" },
  none_of: { label: "is none of", input: "list" },
  is_yes: { label: "is yes", input: "none" },
  is_no: { label: "is no", input: "none" },
  is_set: { label: "has a value", input: "none" },
  is_empty: { label: "is empty", input: "none" },
};

/** The operators that make sense for each kind of field, most-used first. */
export const OPS_FOR: Record<FieldType, ConditionOp[]> = {
  text: ["is", "is_not", "contains", "not_contains", "starts_with", "is_set", "is_empty"],
  number: ["is", "is_not", "more_than", "less_than", "at_least", "at_most", "between", "is_set", "is_empty"],
  date: ["more_than_days_ago", "less_than_days_ago", "less_than_days_from_now", "more_than_days_from_now", "before", "after", "on", "between", "is_set", "is_empty"],
  yesno: ["is_yes", "is_no", "is_empty"],
  choice: ["any_of", "none_of", "is_set", "is_empty"],
  phone: ["is_set", "is_empty", "starts_with", "contains"],
  email: ["is_set", "is_empty", "contains", "is"],
};

export function defaultOp(type: FieldType): ConditionOp {
  return OPS_FOR[type][0];
}

/** An operator that doesn't fit the field's type falls back to that type's first one. */
export function fitOp(op: ConditionOp, type: FieldType): ConditionOp {
  return OPS_FOR[type].includes(op) ? op : defaultOp(type);
}

export type DateOrder = "dmy" | "mdy";

/**
 * Which way round a column of slash dates is: a first part over 12 means
 * day/month, a second part over 12 means month/day. When nothing settles it,
 * day/month (Australia first; US workspaces will set it). Bug B18: "03/04/2026"
 * was read as 4 March.
 */
export function dateOrderOf(values: string[], fallback: DateOrder = "dmy"): DateOrder {
  for (const v of values) {
    const m = v.trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
    if (!m) continue;
    if (Number(m[1]) > 12) return "dmy";
    if (Number(m[2]) > 12) return "mdy";
  }
  return fallback;
}

/** "2026-04-03" from "2026-04-03", "03/04/2026" (dmy) or "4/3/26" (mdy); null if it isn't a date. */
export function toIsoDate(value: string | undefined, order: DateOrder = "dmy"): string | null {
  const v = (value ?? "").trim();
  const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  let y: number, mo: number, d: number;
  if (iso) [y, mo, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else {
    const m = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
    if (!m) return null;
    const [a, b] = [Number(m[1]), Number(m[2])];
    [d, mo] = order === "dmy" ? [a, b] : [b, a];
    y = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]);
  }
  const date = new Date(y, mo - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Only real dates count ("2026-11-26", "26/11/2026"); "7" is not a date (it was read as July 2001). */
function parseDate(value: string | undefined): Date | null {
  const iso = toIsoDate(value);
  return iso ? new Date(`${iso}T00:00:00`) : null;
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function num(value: string | undefined): number | null {
  if (value === undefined || value.trim() === "") return null;
  const n = Number(value.replace(/[,$\s]/g, ""));
  return Number.isNaN(n) ? null : n;
}

function list(value: string | undefined): string[] {
  return (value ?? "").split(",").map((v) => v.trim().toLowerCase()).filter(Boolean);
}

const YES = ["yes", "y", "true", "1"];
const NO = ["no", "n", "false", "0"];

/** Does one rule hold for this value? An empty value only matches "is empty" (and "is not" / "doesn't contain" / "none of"). */
export function holds(condition: Condition, raw: string | undefined, now = new Date()): boolean {
  const value = (raw ?? "").trim();
  const text = value.toLowerCase();
  const target = (condition.value ?? "").trim().toLowerCase();
  const { op } = condition;

  if (op === "is_set") return value !== "";
  if (op === "is_empty") return value === "";
  if (op === "is_yes") return YES.includes(text);
  if (op === "is_no") return NO.includes(text);
  if (op === "is_not") return text !== target;
  if (op === "not_contains") return !text.includes(target);
  if (op === "none_of") return !list(condition.value).includes(text);
  if (value === "") return false;

  if (op === "is") {
    const a = num(value);
    const b = num(condition.value);
    return a !== null && b !== null ? a === b : text === target;
  }
  if (op === "contains") return text.includes(target);
  if (op === "starts_with") return text.startsWith(target);
  if (op === "any_of") return list(condition.value).includes(text);

  if (op === "more_than" || op === "less_than" || op === "at_least" || op === "at_most" || (op === "between" && num(value) !== null && num(condition.value) !== null)) {
    const a = num(value);
    const b = num(condition.value);
    if (a === null || b === null) return false;
    if (op === "more_than") return a > b;
    if (op === "less_than") return a < b;
    if (op === "at_least") return a >= b;
    if (op === "at_most") return a <= b;
    const c = num(condition.value2);
    return c !== null && a >= Math.min(b, c) && a <= Math.max(b, c);
  }

  const date = parseDate(value);
  if (!date) return false;
  const day = startOfDay(date);
  const today = startOfDay(now);
  if (op === "before" || op === "after" || op === "on" || op === "between") {
    const a = parseDate(condition.value);
    if (!a) return false;
    if (op === "before") return day < startOfDay(a);
    if (op === "after") return day > startOfDay(a);
    if (op === "on") return day === startOfDay(a);
    const b = parseDate(condition.value2);
    if (!b) return false;
    return day >= Math.min(startOfDay(a), startOfDay(b)) && day <= Math.max(startOfDay(a), startOfDay(b));
  }
  const days = num(condition.value);
  if (days === null) return false;
  const diff = Math.round((day - today) / DAY); // negative = in the past
  if (op === "less_than_days_ago") return diff <= 0 && -diff < days;
  if (op === "more_than_days_ago") return -diff > days;
  if (op === "less_than_days_from_now") return diff >= 0 && diff < days;
  if (op === "more_than_days_from_now") return diff > days;
  return false;
}

/** Every rule ("all") or at least one ("any"). An empty group lets everyone through. */
export function groupHolds(group: ConditionGroup, values: Record<string, string>, now = new Date()): boolean {
  if (group.rules.length === 0) return true;
  const results = group.rules.map((rule) => holds(rule, values[rule.field], now));
  return group.match === "all" ? results.every(Boolean) : results.some(Boolean);
}

/** "Purchase date is more than 30 days ago", in plain words. */
export function describe(condition: Condition, fieldLabel: string): string {
  const info = OPS[condition.op];
  if (info.input === "none") return `${fieldLabel} ${info.label}`;
  if (info.input === "range") return `${fieldLabel} is between ${condition.value ?? "…"} and ${condition.value2 ?? "…"}`;
  if (info.input === "days") return `${fieldLabel} ${info.label.replace("…", condition.value || "…")}`;
  if (info.input === "list") return `${fieldLabel} ${info.label} ${list(condition.value).join(", ") || "…"}`;
  return `${fieldLabel} ${info.label} "${condition.value ?? ""}"`;
}

/** Guess a column's type from sample values: date, number, yes/no, email, phone, or text. */
export function guessType(samples: string[]): FieldType {
  const vals = samples.map((s) => s.trim()).filter(Boolean);
  if (vals.length === 0) return "text";
  const all = (re: RegExp) => vals.every((v) => re.test(v));
  if (all(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) return "email";
  if (all(/^\d{4}-\d{2}-\d{2}/) || all(/^\d{1,2}\/\d{1,2}\/\d{2,4}$/)) return "date"; // before phone: 2026-01-02 is all digits and dashes
  if (all(/^\+?[\d\s().-]{7,}$/) && vals.every((v) => v.replace(/\D/g, "").length >= 7)) return "phone";
  if (vals.every((v) => [...YES, ...NO].includes(v.toLowerCase()))) return "yesno";
  if (all(/^-?[\d,]*\.?\d+$/)) return "number";
  const distinct = new Set(vals.map((v) => v.toLowerCase()));
  if (vals.length >= 6 && distinct.size <= Math.max(2, Math.floor(vals.length / 3))) return "choice";
  return "text";
}
