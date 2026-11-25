// Automations in plain words, and who they would call. Pure, so the builder can
// preview "who gets a call next" before anything is switched on.

import type { Automation, Condition, Contact, FieldDef, Flow, Trigger } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

export const OP_LABELS: Record<Condition["op"], string> = {
  is: "is",
  is_not: "is not",
  contains: "contains",
  more_than: "is more than",
  less_than: "is less than",
  is_yes: "is yes",
  is_no: "is no",
  is_empty: "is empty",
  is_set: "has a value",
};

/** Operators that need no value typed in. */
export const VALUELESS_OPS: Condition["op"][] = ["is_yes", "is_no", "is_empty", "is_set"];

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
  const field = fieldLabel(condition.field, defs);
  if (VALUELESS_OPS.includes(condition.op)) return `${field} ${OP_LABELS[condition.op]}`;
  return `${field} ${OP_LABELS[condition.op]} "${condition.value ?? ""}"`;
}

export function conditionHolds(condition: Condition, values: Record<string, string>): boolean {
  const raw = (values[condition.field] ?? "").trim();
  const value = raw.toLowerCase();
  const target = (condition.value ?? "").trim().toLowerCase();
  if (condition.op === "is_set") return raw !== "";
  if (condition.op === "is_empty") return raw === "";
  if (condition.op === "is_yes") return ["yes", "y", "true"].includes(value);
  if (condition.op === "is_no") return ["no", "n", "false"].includes(value);
  if (condition.op === "is") return value === target;
  if (condition.op === "is_not") return value !== target;
  if (condition.op === "contains") return value.includes(target);
  const a = Number(raw);
  const b = Number(condition.value);
  if (Number.isNaN(a) || Number.isNaN(b)) return false;
  return condition.op === "more_than" ? a > b : a < b;
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
