// Campaigns: who gets called, by which agent, when, and what happens after.
// A basic campaign is an agent + an audience + timing; triggers, conditions,
// follow-ups and write-backs are added only when wanted. Pure.

import { daysLabel, fieldLabel } from "./automation";
import { describe as describeRule, groupHolds } from "./conditions";
import { dataSchema } from "./agent-data";
import { flowIssues, newId, outcomesOf } from "./flow-tree";
import { hourLabel, WEEKDAYS } from "./format";
import { countryOfZone, dncSet, toE164 } from "./phone";
import type { Campaign, Contact, FieldDef, Flow, Trigger, WorkspaceSettings } from "./types";

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

/** Numbers never to call (as E.164) and the country local numbers are read in. */
export interface CallRules {
  doNotCall?: Set<string>;
  country?: Parameters<typeof toE164>[1];
}

/** The workspace's do-not-call list and country, ready for audienceOf. */
export function callRulesFor(settings: Pick<WorkspaceSettings, "timezone" | "doNotCall">): CallRules {
  const country = countryOfZone(settings.timezone);
  return { country, doNotCall: dncSet(settings.doNotCall, country) };
}

function matches(campaign: Pick<Campaign, "audience">, c: Contact, now: Date): boolean {
  return (!campaign.audience.list || c.groups.includes(campaign.audience.list)) && groupHolds(campaign.audience.filter, { ...c.fields, name: c.name, phone: c.phone, email: c.email ?? "" }, now);
}

/** Who the campaign would call right now, and who it skips and why (bugs B25, B34). */
export function audienceBreakdown(campaign: Pick<Campaign, "audience">, contacts: Contact[], now = new Date(), rules: CallRules = {}) {
  const included: Contact[] = [];
  let doNotCall = 0;
  let badPhone = 0;
  for (const c of contacts) {
    if (!matches(campaign, c, now)) continue;
    const e164 = toE164(c.phone, rules.country);
    if (!e164) badPhone++;
    else if (rules.doNotCall?.has(e164)) doNotCall++;
    else included.push(c);
  }
  return { included, skipped: { doNotCall, badPhone } };
}

/** Everyone the campaign calls right now: the list, then any conditions, minus do-not-call and numbers that can't be dialled. */
export function audienceOf(campaign: Pick<Campaign, "audience">, contacts: Contact[], now = new Date(), rules: CallRules = {}): Contact[] {
  return audienceBreakdown(campaign, contacts, now, rules).included;
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

/**
 * When a date-triggered campaign calls this contact, or null. Counted in
 * calendar days, so a daylight-saving change doesn't move it a day (bug B4).
 */
export function dueDate(trigger: Trigger, contact: Contact): Date | null {
  if (trigger.kind !== "date_field") return null;
  const raw = contact.fields[trigger.field];
  const m = raw?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const sign = trigger.when === "after" ? 1 : trigger.when === "before" ? -1 : 0;
  const due = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + sign * trigger.offsetDays);
  return Number.isNaN(due.getTime()) ? null : due;
}

export interface PlannedCall {
  contact: Contact;
  due: Date;
}

/** For a date-triggered, always-on campaign: who's due from today up to `horizonDays` ahead, soonest first. */
export function upcomingCalls(campaign: Campaign, contacts: Contact[], now: Date, horizonDays = 90, rules: CallRules = {}): PlannedCall[] {
  if (campaign.mode !== "always") return [];
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return audienceOf(campaign, contacts, now, rules)
    .flatMap((contact) => {
      const due = dueDate(campaign.trigger, contact);
      if (!due || due.getTime() < today || due.getTime() > today + horizonDays * DAY) return [];
      return [{ contact, due }];
    })
    .sort((a, b) => a.due.getTime() - b.due.getTime());
}

export interface CampaignContext {
  flows: Flow[];
  defs: FieldDef[];
  audienceCount: number;
  now?: Date;
  workspace?: Pick<WorkspaceSettings, "callingDays" | "callingStart" | "callingEnd">;
}

/** Is this agent fit to make calls right now? A reason, or null. */
function agentProblem(agent: Flow | undefined, defs: FieldDef[], role = "The agent"): string | null {
  if (!agent) return `${role} has been deleted. Pick another.`;
  if (agent.status !== "live") return `${role} (${agent.name}) is a draft. Put it live first.`;
  if (!agent.numberId) return `${role} (${agent.name}) has no phone number to call from.`;
  if (agent.direction === "inbound") return `${role} (${agent.name}) only answers calls. Set it to make calls.`;
  if (flowIssues(agent, [...defs.map((d) => ({ key: d.key, type: d.type })), "name", "phone"]).length) return `${role} (${agent.name}) has problems to fix first.`;
  return null;
}

/** What stops a campaign from starting or running. */
export function campaignIssues(c: Campaign, ctx: CampaignContext): string[] {
  const issues: string[] = [];
  const now = ctx.now ?? new Date();
  const agent = ctx.flows.find((f) => f.id === c.agentId);
  if (!c.agentId) issues.push("Pick an agent.");
  else {
    const problem = agentProblem(agent, ctx.defs);
    if (problem) issues.push(problem);
  }
  if (c.days.length === 0) issues.push("Pick at least one day to call.");
  if (c.endHour <= c.startHour) issues.push("Calling hours end before they start.");
  const ws = ctx.workspace;
  if (ws && (c.startHour < ws.callingStart || c.endHour > ws.callingEnd || c.days.some((d) => !ws.callingDays.includes(d)))) {
    issues.push(`These hours go outside your workspace's calling hours (${daysWords(ws.callingDays)}, ${hourLabel(ws.callingStart)} to ${hourLabel(ws.callingEnd)}). Change one or the other in Settings.`);
  }
  if (c.mode === "once" && ctx.audienceCount === 0) issues.push("Nobody in the audience can be called yet.");
  if (c.mode === "once" && c.startAt && new Date(c.startAt).getTime() < now.getTime() - 60_000 && c.status !== "running") issues.push("The start time has passed. Pick a new one, or start when you start it.");
  if (c.mode === "always" && c.trigger.kind === "date_field" && !c.trigger.field) issues.push("Pick the date field that starts the calls.");
  if (c.mode === "always" && c.trigger.kind === "field_change" && !c.trigger.field) issues.push("Pick the field to watch.");
  if (c.mode === "always" && c.trigger.kind === "field_change" && c.trigger.field && !c.trigger.becomes.trim()) issues.push("Say what value the field changes to.");
  if (c.voicemail === "leave_message" && !c.voicemailText.trim()) issues.push("Write the voicemail message.");

  // Follow-ups and write-backs must still fit the agent (bug B22).
  const outcomes = agent ? outcomesOf(agent) : [];
  for (const f of c.followUps) {
    if (agent && !outcomes.includes(f.outcome)) issues.push(`A follow-up waits for "${f.outcome || "…"}", but ${agent.name} never ends that way.`);
    if (f.action === "text" && !f.text?.trim()) issues.push("Write the follow-up text.");
    if (f.action === "call" && f.agentId && f.agentId !== c.agentId) {
      const problem = agentProblem(ctx.flows.find((x) => x.id === f.agentId), ctx.defs, "The follow-up agent");
      if (problem) issues.push(problem);
    }
  }
  const schema = agent ? dataSchema(agent) : [];
  for (const w of c.writeBacks) {
    const answer = schema.find((s) => s.key === w.from);
    const field = ctx.defs.find((d) => d.key === w.to);
    if (agent && !answer) issues.push(`"${w.from}" isn't collected by ${agent.name} any more. Remove that saved answer or pick another.`);
    else if (answer && field && answer.type !== field.type && !(field.type === "text")) issues.push(`"${answer.label || answer.key}" is ${answer.type === "yesno" ? "yes/no" : `a ${answer.type}`}, but the contact field "${field.label}" is ${field.type === "yesno" ? "yes/no" : `a ${field.type}`}.`);
  }
  if (c.webhook.trim() && !/^https:\/\/[^\s/]+\.[^\s]+$/.test(c.webhook.trim())) issues.push("The webhook needs a full https:// address.");
  return issues;
}
