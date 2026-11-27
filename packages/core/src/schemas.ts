// What the API accepts, as zod schemas mirroring lib types (types.ts). Every
// string and list has a size cap, so one request can't store megabytes or slow
// the database. The API validates every write with these; the front end can
// use them too. Recursive Step trees use z.lazy.

import { z } from "zod";
import type { ConditionOp, Step } from "./types";

const id = z.string().min(1).max(64);
const key = z.string().min(1).max(64).regex(/^[a-z][a-z0-9_]*$/, "Use lower-case letters, numbers and _ (like car_model).");
const short = (max = 200) => z.string().max(max);
const text = (max = 4000) => z.string().max(max);

/** The longest description of an agent (Write with AI's brief, a Change with AI message). One cap everywhere, so a brief the writer took can always be saved. */
export const BRIEF_MAX = 8000;

export const OPS = [
  "is", "is_not", "contains", "not_contains", "starts_with",
  "more_than", "less_than", "at_least", "at_most", "between",
  "before", "after", "on", "less_than_days_ago", "more_than_days_ago", "less_than_days_from_now", "more_than_days_from_now",
  "any_of", "none_of", "is_yes", "is_no", "is_set", "is_empty",
] as const satisfies readonly ConditionOp[];

export const FIELD_TYPES = ["text", "number", "date", "yesno", "choice", "phone", "email"] as const;

export const ConditionSchema = z.object({
  field: z.string().max(64),
  op: z.enum(OPS),
  value: short(500).optional(),
  value2: short(200).optional(),
});

export const ConditionGroupSchema = z.object({
  match: z.enum(["all", "any"]),
  rules: z.array(ConditionSchema).max(30),
});

export const StepSchema: z.ZodType<Step> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.object({ id, kind: z.literal("say"), text: text(2000) }),
    z.object({ id, kind: z.literal("ask"), question: text(1000), field: z.string().max(64), answerType: z.enum(["text", "yesno", "number", "date", "choice"]), choices: z.array(short(100)).max(20).optional() }),
    z.object({ id, kind: z.literal("branch"), condition: ConditionSchema, yes: z.array(StepSchema).max(60), no: z.array(StepSchema).max(60) }),
    z.object({ id, kind: z.literal("action"), action: z.enum(["book", "transfer", "text", "crm", "webhook"]), detail: text(1000), integration: z.string().max(40).optional() }),
    z.object({ id, kind: z.literal("end"), outcome: z.string().max(64), text: text(1000) }),
  ]),
) as z.ZodType<Step>;

export const AgentVoiceSchema = z.object({
  name: short(60),
  voiceId: short(40),
  personality: z.enum(["friendly", "professional", "upbeat", "calm"]),
  speed: z.number().min(0.9).max(1.2),
  language: short(40),
});

export const DataFieldSchema = z.object({
  key: z.string().max(64),
  label: short(100),
  type: z.enum(FIELD_TYPES),
  description: text(500),
  required: z.boolean(),
  fallback: short(200).optional(),
  choices: z.array(short(100)).max(20).optional(),
});

export const SuccessCheckSchema = z.object({ id, label: short(120), description: text(500) });
export const AgentToolSchema = z.object({ id, kind: z.enum(["mcp", "api", "integration"]), name: short(80), url: z.union([z.string().url().max(500), z.literal("")]), description: text(1000), integration: z.string().max(40).optional() });
export const AfterCallSchema = z.object({ id, kind: z.enum(["save_contact", "add_row", "send_webhook", "post_message"]), integration: z.string().max(40), fields: z.array(z.string().max(64)).max(60), detail: text(1000) });

/** The parts of an agent its owner edits (status, number and ids are set by their own endpoints). */
export const AgentDraftSchema = z.object({
  name: short(80).min(1),
  description: short(300),
  direction: z.enum(["inbound", "outbound", "both"]),
  agent: AgentVoiceSchema,
  greeting: text(1000),
  business: short(120).optional(),
  prompt: text(12000),
  brief: text(BRIEF_MAX).optional(),
  timezone: short(64),
  tools: z.array(AgentToolSchema).max(20),
  steps: z.array(StepSchema).max(60),
  knowledgeIds: z.array(id).max(100),
  dataFields: z.array(DataFieldSchema).max(50),
  askRequired: z.record(z.string().max(64), z.boolean()),
  checks: z.array(SuccessCheckSchema).max(10),
  afterCall: z.array(AfterCallSchema).max(20).optional(),
});
export type AgentDraft = z.infer<typeof AgentDraftSchema>;

export const FieldDefSchema = z.object({
  key,
  label: short(100).min(1),
  type: z.enum(FIELD_TYPES),
  choices: z.array(short(100)).max(50).optional(),
  source: short(64).optional(),
});

export const ContactInputSchema = z.object({
  name: short(200),
  phone: short(40),
  email: z.string().email().max(200).optional().or(z.literal("")),
  groups: z.array(short(80)).max(30),
  fields: z.record(z.string().max(64), z.string().max(2000)),
});

export const TriggerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("added") }),
  z.object({ kind: z.literal("date_field"), field: z.string().max(64), offsetDays: z.number().int().min(0).max(3650), when: z.enum(["after", "before", "on"]) }),
  z.object({ kind: z.literal("field_change"), field: z.string().max(64), becomes: short(200) }),
  z.object({ kind: z.literal("schedule"), every: z.enum(["day", "week", "month"]), time: z.string().regex(/^\d{2}:\d{2}$/) }),
]);

export const CampaignInputSchema = z.object({
  name: short(120).min(1),
  agentId: z.string().max(64),
  mode: z.enum(["once", "always"]),
  audience: z.object({ list: short(80).nullable(), filter: ConditionGroupSchema }),
  trigger: TriggerSchema,
  startAt: z.string().max(40).nullable(),
  days: z.array(z.number().int().min(0).max(6)).max(7),
  startHour: z.number().int().min(0).max(23),
  endHour: z.number().int().min(1).max(24),
  contactTimezone: z.boolean(),
  concurrent: z.number().int().min(1).max(50),
  attempts: z.number().int().min(1).max(5),
  retryHours: z.number().int().min(1).max(72),
  voicemail: z.enum(["hang_up", "leave_message"]),
  voicemailText: text(1000),
  maxPerWeek: z.number().int().min(1).max(7),
  followUps: z.array(z.object({ id, outcome: z.string().max(64), action: z.enum(["call", "text"]), afterDays: z.number().int().min(0).max(365), agentId: z.string().max(64).optional(), text: text(600).optional() })).max(10),
  writeBacks: z.array(z.object({ from: z.string().max(64), to: z.string().max(64) })).max(30),
  logTo: z.array(short(40)).max(10),
  webhook: z.string().max(500),
});
export type CampaignInput = z.infer<typeof CampaignInputSchema>;

/** Fields that can't change while a campaign is running (pause first). */
export const CAMPAIGN_LOCKED_WHILE_RUNNING = ["agentId", "mode", "audience", "trigger", "days", "startHour", "endHour", "contactTimezone"] as const;

export const KnowledgeInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.enum(["url", "sitemap", "site"]), source: z.string().url().max(500), name: short(200).optional(), availableToAll: z.boolean(), attachTo: id.optional() }),
  z.object({ kind: z.literal("text"), name: short(200).min(1), content: text(400_000), availableToAll: z.boolean(), attachTo: id.optional() }),
  z.object({ kind: z.literal("file"), name: short(200).min(1), content: text(2_000_000), availableToAll: z.boolean(), attachTo: id.optional() }),
]);

export const SettingsSchema = z.object({
  businessName: short(120).min(1),
  timezone: short(64),
  callingDays: z.array(z.number().int().min(0).max(6)).max(7),
  callingStart: z.number().int().min(0).max(23),
  callingEnd: z.number().int().min(1).max(24),
  doNotCall: z.array(short(40)).max(20000),
});

export const ContactQuerySchema = z.object({
  search: short(120).default(""),
  list: short(80).nullable().default(null),
  filter: ConditionGroupSchema.default({ match: "all", rules: [] }),
  sort: z.object({ key: z.string().max(64), dir: z.enum(["asc", "desc"]) }).nullable().default(null),
  page: z.number().int().min(1).max(100000).default(1),
  pageSize: z.number().int().min(1).max(200).default(50),
});
export type ContactQuery = z.infer<typeof ContactQuerySchema>;

export const EmailSchema = z.string().trim().toLowerCase().email().max(200);
