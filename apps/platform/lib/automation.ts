// Automations in plain words, and who they would call. Pure, so the builder can
// preview "who gets a call next" before anything is switched on.

import { OPS, describe, holds } from "./conditions";
import type { Automation, Condition, Contact, FieldDef, Flow, Trigger } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Labels and "no value needed" operators, from the shared rule engine (lib/conditions.ts). */
export const OP_LABELS = Object.fromEntries(Object.entries(OPS).map(([op, info]) => [op, info.label])) as Record<Condition["op"], string>;
export const VALUELESS_OPS = (Object.keys(OPS) as Condition["op"][]).filter((op) => OPS[op].input === "none");

export function fieldLabel(key: string, defs: FieldDef[]): string {
  return defs.find((def) => def.key === key)?.label ?? key.replace(/_/g, " ");
}

export function describeTrigger(trigger: Trigger, defs: FieldDef[], flows: Flow[]): string {
  if (trigger.kind === "date_field") {
    const days = plural(trigger.offsetDays, "day");
    return `${days} ${trigger.when} ${fieldLabel(trigger.field, defs).toLowerCase()}`;
  }
  if (trigger.kind === "field_change") return `When ${fieldLabel(trigger.field, defs).toLowerCase()} becomes "${trigger.becomes}"`;
  if (trigger.kind === "new_contact") return trigger.group ? `When a contact is added to ${trigger.group}` : "When a new contact is added";
  if (trigger.kind === "schedule") return `Every ${trigger.every} at ${trigger.time}`;
  const flow = flows.find((f) => f.id === trigger.flowId)?.name ?? "a flow";
  return `When "${flow}" ends with ${trigger.outcome.replace(/_/g, " ")}`;
}

export function describeCondition(condition: Condition, defs: FieldDef[]): string {
  return describe(condition, fieldLabel(condition.field, defs));
}

export function conditionHolds(condition: Condition, values: Record<string, string>, now = new Date()): boolean {
  return holds(condition, values[condition.field], now);
}

export function matchesAll(conditions: Condition[], contact: Contact): boolean {
  return conditions.every((condition) => conditionHolds(condition, contact.fields));
}

/** When a date-based automation calls this contact, or null if it never would. */
export function dueDateFor(trigger: Trigger, contact: Contact): Date | null {
  if (trigger.kind !== "date_field") return null;
  const base = parseDate(contact.fields[trigger.field]);
  if (!base) return null;
  const sign = trigger.when === "after" ? 1 : -1;
  return new Date(base.getTime() + sign * trigger.offsetDays * DAY_MS);
}

export interface PlannedCall {
  contact: Contact;
  due: Date;
}

/**
 * The calls a date-based automation would place from `now` up to `horizonDays`
 * ahead, soonest first. Other trigger kinds fire on events, so they plan nothing.
 */
export function upcomingCalls(automation: Automation, contacts: Contact[], now: Date, horizonDays = 90): PlannedCall[] {
  const end = now.getTime() + horizonDays * DAY_MS;
  return contacts
    .filter((contact) => matchesAll(automation.conditions, contact))
    .flatMap((contact) => {
      const due = dueDateFor(automation.trigger, contact);
      if (!due) return [];
      if (due.getTime() < startOfDay(now).getTime() || due.getTime() > end) return [];
      return [{ contact, due }];
    })
    .sort((a, b) => a.due.getTime() - b.due.getTime());
}

/** How many contacts this automation could ever reach (conditions only). */
export function audienceSize(automation: Automation, contacts: Contact[]): number {
  return contacts.filter((contact) => matchesAll(automation.conditions, contact)).length;
}

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** 90 → "3 months", 7 → "7 days". */
export function daysLabel(days: number): string {
  return plural(days, "day");
}

function plural(n: number, word: string): string {
  if (n % 30 === 0 && n >= 30 && word === "day") return n === 30 ? "1 month" : `${n / 30} months`;
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}
