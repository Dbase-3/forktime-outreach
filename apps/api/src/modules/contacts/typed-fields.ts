// Contact field values are stored typed so the database can filter and sort
// them properly: numbers as numbers, yes/no as booleans, dates as
// "YYYY-MM-DD" (sorts correctly as text), the rest as text. The API speaks
// strings to the front end, as the core types do.

import { toIsoDate, type DateOrder } from "@outreach/core/conditions";
import type { FieldDef, FieldType } from "@outreach/core/types";

const YES = ["yes", "y", "true", "1"];
const NO = ["no", "n", "false", "0"];

export type Stored = string | number | boolean;

export function storeValue(raw: string, type: FieldType, order: DateOrder = "dmy"): Stored | undefined {
  const v = raw.trim();
  if (!v) return undefined;
  if (type === "number") {
    const n = Number(v.replace(/[,$\s]/g, ""));
    return Number.isFinite(n) ? n : v;
  }
  if (type === "yesno") {
    const l = v.toLowerCase();
    return YES.includes(l) ? true : NO.includes(l) ? false : v;
  }
  if (type === "date") return toIsoDate(v, order) ?? v;
  return v;
}

export function storeFields(fields: Record<string, string>, defs: Pick<FieldDef, "key" | "type">[], order: DateOrder = "dmy"): Record<string, Stored> {
  const typeOf = new Map(defs.map((d) => [d.key, d.type]));
  const out: Record<string, Stored> = {};
  for (const [k, raw] of Object.entries(fields)) {
    const value = storeValue(String(raw ?? ""), typeOf.get(k) ?? "text", order);
    if (value !== undefined) out[k] = value;
  }
  return out;
}

export function plainFields(stored: Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(stored ?? {})) {
    if (v === null || v === undefined) continue;
    out[k] = typeof v === "boolean" ? (v ? "Yes" : "No") : String(v);
  }
  return out;
}
