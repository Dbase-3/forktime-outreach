// Conditions in plain words, on top of the shared rule engine (lib/conditions.ts).
// Campaign triggers and timing live in lib/campaign.ts.

import { OPS, describe, holds } from "./conditions";
import type { Condition, FieldDef } from "./types";

/** Labels and "no value needed" operators, from the shared rule engine. */
export const OP_LABELS = Object.fromEntries(Object.entries(OPS).map(([op, info]) => [op, info.label])) as Record<Condition["op"], string>;
export const VALUELESS_OPS = (Object.keys(OPS) as Condition["op"][]).filter((op) => OPS[op].input === "none");

export function fieldLabel(key: string, defs: FieldDef[]): string {
  return defs.find((def) => def.key === key)?.label ?? key.replace(/_/g, " ");
}

export function describeCondition(condition: Condition, defs: FieldDef[]): string {
  return describe(condition, fieldLabel(condition.field, defs));
}

export function conditionHolds(condition: Condition, values: Record<string, string>, now = new Date()): boolean {
  return holds(condition, values[condition.field], now);
}

/** 90 → "3 months", 7 → "1 week", 3 → "3 days". */
export function daysLabel(n: number): string {
  if (n >= 30 && n % 30 === 0) return n === 30 ? "1 month" : `${n / 30} months`;
  if (n >= 7 && n % 7 === 0) return n === 7 ? "1 week" : `${n / 7} weeks`;
  return `${n} ${n === 1 ? "day" : "days"}`;
}
