// Campaigns: who gets called, by which agent, when, and what happens after.
// A basic campaign is an agent + an audience + timing; triggers, conditions,
// follow-ups and write-backs are added only when wanted. Pure.

import { daysLabel, fieldLabel } from "./automation";
import { describe as describeRule, groupHolds } from "./conditions";
import { newId } from "./flow-tree";
import { hourLabel, WEEKDAYS } from "./format";
import type { Campaign, Contact, FieldDef, Flow, Trigger } from "./types";

const DAY = 24 * 60 * 60 * 1000;

export function defaultCampaign(agentId: string, now = new Date()): Campaign {
  return {
    id: newId("cmp"),
    name: "New campaign",
    agentId,
    status: "draft",
    mode: "once",
    audience: { list: null, filter: { match: "all", rules: [] } },
    trigger: { kind: "added" },
    startAt: null,
    days: [1, 2, 3, 4, 5],
    startHour: 9,
    endHour: 18,
    contactTimezone: true,
    concurrent: 2,
    attempts: 2,
    retryHours: 4,
    voicemail: "hang_up",
    voicemailText: "",
    maxPerWeek: 1,
    followUps: [],
    writeBacks: [],
    logTo: [],
    webhook: "",
    called: 0,
    answered: 0,
    createdAt: now.toISOString(),
  };
}

/** Everyone the campaign is aimed at right now: the list, then any conditions. */
export function audienceOf(campaign: Pick<Campaign, "audience">, contacts: Contact[], now = new Date()): Contact[] {
  return contacts.filter((c) => (!campaign.audience.list || c.groups.includes(campaign.audience.list)) && groupHolds(campaign.audience.filter, { ...c.fields, name: c.name, phone: c.phone, email: c.email ?? "" }, now));
}

export function describeTrigger(trigger: Trigger, defs: FieldDef[]): string {
  if (trigger.kind === "added") return "As soon as someone joins the audience";
  if (trigger.kind === "field_change") return `When ${fieldLabel(trigger.field, defs).toLowerCase()} becomes "${trigger.becomes || "…"}"`;
  if (trigger.kind === "schedule") return `Every ${trigger.every} at ${trigger.time}`;
  const field = fieldLabel(trigger.field, defs).toLowerCase() || "a date";
  if (trigger.when === "on") return `On their ${field}`;
  return `${daysLabel(trigger.offsetDays)} ${trigger.when} their ${field}`;
}

/** The days the campaign calls, said briefly: "Weekdays", "Every day", "Mon, Wed, Fri". */
export function daysWords(days: number[]): string {
  const sorted = [...days].sort();
  if (sorted.length === 7) return "Every day";
  if (sorted.join() === "1,2,3,4,5") return "Weekdays";
  if (sorted.join() === "0,6") return "Weekends";
  const run = sorted.length >= 3 && sorted.every((d, i) => i === 0 || d === sorted[i - 1] + 1);
  if (run) return `${WEEKDAYS[sorted[0]]} to ${WEEKDAYS[sorted[sorted.length - 1]]}`;
  return sorted.map((d) => WEEKDAYS[d]).join(", ");
}

/** One paragraph a person can check at a glance. */
export function campaignSummary(c: Campaign, flows: Pick<Flow, "id" | "name">[], defs: FieldDef[], audienceCount: number): string[] {
  const agent = flows.find((f) => f.id === c.agentId)?.name ?? "no agent yet";
  const who = c.audience.list ? `the ${c.audience.list} list` : "all contacts";
  const rules = c.audience.filter.rules.map((r) => describeRule(r, fieldLabel(r.field, defs)).replace(/^./, (x) => x.toLowerCase()));
  const lines = [
    `${agent} calls ${who}${rules.length ? ` where ${rules.join(c.audience.filter.match === "all" ? " and " : " or ")}` : ""} (${audienceCount} ${audienceCount === 1 ? "person" : "people"} now).`,
    c.mode === "always" ? `${describeTrigger(c.trigger, defs)}.` : c.startAt ? `Starting ${new Date(c.startAt).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}.` : "Starting as soon as you start it.",
    `${daysWords(c.days)}, ${hourLabel(c.startHour)} to ${hourLabel(c.endHour)}${c.contactTimezone ? " in each person's time zone" : ""}. No answer: ${c.attempts > 1 ? `${c.attempts - 1} more ${c.attempts === 2 ? "try" : "tries"}, ${c.retryHours} h apart` : "no retry"}.`,
  ];
  for (const f of c.followUps) {
    const what = f.action === "call" ? `call again${f.agentId && f.agentId !== c.agentId ? ` with ${flows.find((x) => x.id === f.agentId)?.name ?? "another agent"}` : ""}` : "send a text";
    lines.push(`If it ends ${f.outcome.replace(/_/g, " ")}, ${what} ${f.afterDays === 0 ? "straight away" : `after ${daysLabel(f.afterDays)}`}.`);
  }
  if (c.writeBacks.length) lines.push(`Saves ${c.writeBacks.length} ${c.writeBacks.length === 1 ? "answer" : "answers"} to the contact.`);
  return lines;
}

/** When a date-triggered campaign calls this contact, or null. */
export function dueDate(trigger: Trigger, contact: Contact): Date | null {
  if (trigger.kind !== "date_field") return null;
  const raw = contact.fields[trigger.field];
  if (!raw) return null;
  const base = new Date(`${raw.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(base.getTime())) return null;
  const sign = trigger.when === "after" ? 1 : trigger.when === "before" ? -1 : 0;
  return new Date(base.getTime() + sign * trigger.offsetDays * DAY);
}

export interface PlannedCall {
  contact: Contact;
  due: Date;
}

/** For a date-triggered, always-on campaign: who's due from today up to `horizonDays` ahead, soonest first. */
export function upcomingCalls(campaign: Campaign, contacts: Contact[], now: Date, horizonDays = 90): PlannedCall[] {
  if (campaign.mode !== "always") return [];
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return audienceOf(campaign, contacts, now)
    .flatMap((contact) => {
      const due = dueDate(campaign.trigger, contact);
      if (!due || due.getTime() < today || due.getTime() > today + horizonDays * DAY) return [];
      return [{ contact, due }];
    })
    .sort((a, b) => a.due.getTime() - b.due.getTime());
}

/** What stops a campaign from starting. */
export function campaignIssues(c: Campaign, flows: Pick<Flow, "id" | "status">[]): string[] {
  const issues: string[] = [];
  const agent = flows.find((f) => f.id === c.agentId);
  if (!agent) issues.push("Pick an agent.");
  else if (agent.status !== "live") issues.push("The agent is a draft. Put it live first.");
  if (c.days.length === 0) issues.push("Pick at least one day to call.");
  if (c.endHour <= c.startHour) issues.push("Calling hours end before they start.");
  if (c.mode === "always" && c.trigger.kind === "date_field" && !c.trigger.field) issues.push("Pick the date field that starts the calls.");
  if (c.mode === "always" && c.trigger.kind === "field_change" && !c.trigger.field) issues.push("Pick the field to watch.");
  if (c.voicemail === "leave_message" && !c.voicemailText.trim()) issues.push("Write the voicemail message.");
  return issues;
}
