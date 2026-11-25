// The platform's data model. Iteration 1 keeps it in the browser (lib/store.ts);
// the same shapes move to the database when the backend lands.

export type Direction = "inbound" | "outbound" | "both";

// ---- Flows: what a call does ----

export type AnswerType = "text" | "yesno" | "number" | "date" | "choice";

export type ConditionOp =
  | "is" | "is_not" | "contains" | "not_contains" | "starts_with"
  | "more_than" | "less_than" | "at_least" | "at_most" | "between"
  | "before" | "after" | "on" | "less_than_days_ago" | "more_than_days_ago" | "less_than_days_from_now" | "more_than_days_from_now"
  | "any_of" | "none_of" | "is_yes" | "is_no" | "is_set" | "is_empty";

export interface Condition {
  field: string;
  op: ConditionOp;
  value?: string; // a list for any_of / none_of is comma-separated
  value2?: string; // the upper end for "between"
}

/** Rules combined with And (all) or Or (any). */
export interface ConditionGroup {
  match: "all" | "any";
  rules: Condition[];
}

export type ActionKind = "book" | "transfer" | "text" | "crm" | "webhook";

export type Step =
  | { id: string; kind: "say"; text: string }
  | { id: string; kind: "ask"; question: string; field: string; answerType: AnswerType; choices?: string[] }
  | { id: string; kind: "branch"; condition: Condition; yes: Step[]; no: Step[] }
  | { id: string; kind: "action"; action: ActionKind; detail: string }
  | { id: string; kind: "end"; outcome: string; text: string };

export type StepKind = Step["kind"];

export type Personality = "friendly" | "professional" | "upbeat" | "calm";

export interface AgentVoice {
  name: string; // what the agent calls itself on the call
  voiceId: string; // from lib/voices.ts; the provider behind it is never shown
  personality: Personality;
  speed: number; // 0.9 to 1.2
  language: string;
}

export interface Flow {
  id: string;
  name: string;
  description: string;
  direction: Direction;
  status: "draft" | "live";
  agent: AgentVoice;
  greeting: string;
  steps: Step[];
  knowledgeIds: string[]; // documents attached to this agent (plus every "available to all" one)
  updatedAt: string;
}

// ---- Knowledge: what agents answer from ----

export interface KnowledgeDoc {
  id: string;
  name: string;
  kind: "url" | "sitemap" | "site" | "file" | "text";
  source?: string; // the address, or the file's name
  content: string; // the text agents read
  sizeBytes: number;
  pages?: number; // sitemap / website: pages read
  status: "ready" | "reading" | "waiting" | "failed"; // waiting = a file type the backend will read
  error?: string;
  availableToAll: boolean; // every agent can use it, no need to attach
  autoRefresh?: boolean; // web documents: re-read daily
  createdAt: string;
  updatedAt: string;
}

// ---- Contacts ----

export type FieldType = "text" | "number" | "date" | "yesno" | "choice" | "phone" | "email";

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  choices?: string[];
  source?: string; // where values come from: a data source id, "call" (saved by an agent) or absent (added by hand)
}

export interface Contact {
  id: string;
  name: string;
  phone: string;
  email?: string;
  groups: string[]; // the lists it's in
  fields: Record<string, string>;
  sourceId?: string; // the import or CRM sync it came from
  createdAt: string;
}

/** Where contacts come from: a CSV import or a CRM / sheet kept in sync. */
export interface DataSource {
  id: string;
  kind: "csv" | "sync";
  integrationId?: string; // sync: hubspot, salesforce, google_sheets…
  name: string; // "HubSpot · Contacts", "buyers-2026.csv"
  object?: string; // sync: which records (Contacts, Leads…)
  list: string; // contacts land in this list
  fieldKeys: string[]; // the fields it fills
  rows: number;
  syncEvery?: "15m" | "1h" | "1d"; // sync only
  lastSyncAt: string;
  status: "synced" | "syncing" | "error";
}

// ---- Automations: when a call happens on its own ----

export type Trigger =
  | { kind: "date_field"; field: string; offsetDays: number; when: "after" | "before" }
  | { kind: "field_change"; field: string; becomes: string }
  | { kind: "new_contact"; group?: string }
  | { kind: "schedule"; every: "day" | "week" | "month"; time: string }
  | { kind: "call_outcome"; flowId: string; outcome: string };

export interface FollowUp {
  outcome: string; // when the call ends with this outcome…
  thenDays: number; // …call again after this many days (0 = no follow-up)
}

export interface Automation {
  id: string;
  name: string;
  enabled: boolean;
  trigger: Trigger;
  conditions: Condition[];
  flowId: string;
  followUps: FollowUp[];
  maxCallsPerWeek: number;
  updatedAt: string;
}

// ---- Campaigns: a one-off batch ----

export interface Campaign {
  id: string;
  name: string;
  flowId: string;
  group: string;
  status: "draft" | "running" | "paused" | "done";
  days: number[]; // 0 = Sunday
  startHour: number;
  endHour: number;
  retries: number;
  total: number;
  called: number;
  answered: number;
  createdAt: string;
}

// ---- Calls ----

export interface TranscriptLine {
  who: "agent" | "caller" | "action"; // "action" = something the agent did (booked, texted…)
  text: string;
  at?: number; // seconds into the recording when the line starts
  reason?: string; // agent lines: its own one-line reason, kept for review
}

export type FeedbackReason = "misunderstood" | "wrong_info" | "booking_mistake" | "talked_over" | "should_transfer" | "robotic" | "other";

export interface CallFeedback {
  rating: "up" | "down";
  reasons: FeedbackReason[];
  note: string;
  at: string;
}

export type EndReason = "caller_hung_up" | "agent_ended" | "transferred" | "no_answer" | "voicemail";

export interface Call {
  id: string;
  contactId: string;
  flowId: string;
  direction: "inbound" | "outbound";
  startedAt: string;
  durationSec: number;
  outcome: string;
  summary: string;
  saved: Record<string, string>;
  transcript: TranscriptLine[];
  recording?: { url?: string; durationSec: number }; // no url = sample call, no audio
  endReason?: EndReason;
  actions?: string[]; // what the call did: booked, transferred, texted, crm, message
  mood?: number[]; // 0..1 per caller line, in order: how upset they sounded
  feedback?: CallFeedback | null;
  live?: boolean; // the call is happening right now
}

// ---- Workspace ----

/** A connected tool (catalog in lib/integrations.ts). Only connected ones are stored. */
export interface Integration {
  id: string;
  connected: boolean;
  account?: string; // which account, e.g. "northside-motors.hubspot.com"
  connectedAt?: string;
}

export interface WorkspaceSettings {
  businessName: string;
  phoneNumber: string;
  inboundFlowId: string;
  timezone: string;
  callingDays: number[];
  callingStart: number;
  callingEnd: number;
  doNotCall: string[];
}

export interface AppState {
  version: number;
  flows: Flow[];
  knowledge: KnowledgeDoc[];
  automations: Automation[];
  contacts: Contact[];
  fieldDefs: FieldDef[];
  sources: DataSource[];
  campaigns: Campaign[];
  calls: Call[];
  integrations: Integration[];
  settings: WorkspaceSettings;
}
