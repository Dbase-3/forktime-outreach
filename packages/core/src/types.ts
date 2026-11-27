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
  | { id: string; kind: "action"; action: ActionKind; detail: string; integration?: string } // integration: the connected tool it uses (integrations.ts id)
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

/** Something the agent pulls out of the call, beyond what its Ask steps save. */
export interface DataField {
  key: string;
  label: string;
  type: FieldType;
  description: string; // what to listen for, in plain words
  required: boolean;
  fallback?: string; // used when the call didn't cover it (fields that aren't required)
  choices?: string[];
}

/** Did the call do its job? Judged after every call: success, failure or unknown. */
export interface SuccessCheck {
  id: string;
  label: string;
  description: string;
}

/** Something outside the workflow the agent can call mid-call (e.g. check calendar availability). Saved now, run in Phase 6. */
export interface AgentTool {
  id: string;
  kind: "mcp" | "api" | "integration";
  name: string;
  url: string; // mcp / api; "" for an integration
  description: string; // when the agent should use it
  integration?: string; // kind "integration": which connected tool (integrations.ts id)
}

/** What happens once a call has ended, from what it collected (e.g. save the contact to GoHighLevel). */
export interface AfterCallAction {
  id: string;
  kind: "save_contact" | "add_row" | "send_webhook" | "post_message";
  integration: string; // integrations.ts id ("webhook" for your own URL)
  fields: string[]; // the collected keys it sends (empty = all)
  detail: string; // in plain words: where it goes and anything special
}

/** An agent (the UI says Agent; the code keeps the name Flow). */
export interface Flow {
  id: string;
  name: string;
  description: string;
  direction: Direction;
  status: "draft" | "live";
  agent: AgentVoice;
  greeting: string;
  /** The company the agent says it's from, when it isn't the workspace's own (an agency building for a client). Blank = the workspace's business name. Fills {business}. */
  business?: string;
  /** Who the agent is and how it behaves: persona, tone, rules, guardrails. The workflow holds the steps. */
  prompt: string;
  /** What the owner asked for when the agent was written for them (kept so the workflow can be rebuilt). */
  brief?: string;
  /** IANA zone the agent lives in: "today", opening hours and booking times are read in it. */
  timezone: string;
  /** The phone number it makes and takes calls on (lib/numbers.ts). One agent per number. */
  numberId?: string;
  /** Tools the agent can use beyond its workflow actions (MCP servers, APIs). Coming soon. */
  tools: AgentTool[];
  steps: Step[];
  knowledgeIds: string[]; // documents attached to this agent (plus every "available to all" one)
  dataFields: DataField[]; // extra things to collect; Ask steps add theirs automatically
  askRequired: Record<string, boolean>; // per Ask field: must the call get it? (default yes)
  checks: SuccessCheck[];
  afterCall?: AfterCallAction[];
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

// ---- Campaigns: who to call, with which agent, when, and what happens after ----

/** What starts a call in a campaign that keeps running ("always on"). */
export type Trigger =
  | { kind: "added" } // a contact joins the audience (new CRM record, import, added by hand)
  | { kind: "date_field"; field: string; offsetDays: number; when: "after" | "before" | "on" }
  | { kind: "field_change"; field: string; becomes: string }
  | { kind: "schedule"; every: "day" | "week" | "month"; time: string };

export interface FollowUp {
  id: string;
  outcome: string; // when a call ends with this outcome…
  action: "call" | "text";
  afterDays: number;
  agentId?: string; // call: which agent (default: the campaign's)
  text?: string; // text: the message
}

export interface WriteBack {
  from: string; // a key the agent collects
  to: string; // a contact field key
}

export interface Campaign {
  id: string;
  name: string;
  agentId: string;
  status: "draft" | "running" | "paused" | "done";
  mode: "once" | "always"; // call the audience once, or keep calling as contacts qualify
  audience: { list: string | null; filter: ConditionGroup };
  trigger: Trigger; // used when mode is "always"
  startAt: string | null; // once: null = as soon as it's started
  days: number[]; // 0 = Sunday
  startHour: number;
  endHour: number;
  contactTimezone: boolean; // hours in each contact's own time zone
  concurrent: number; // calls at the same time
  attempts: number; // tries per contact when nobody answers
  retryHours: number;
  voicemail: "hang_up" | "leave_message";
  voicemailText: string;
  maxPerWeek: number; // calls per contact per week, across this campaign
  followUps: FollowUp[];
  writeBacks: WriteBack[];
  logTo: string[]; // integration ids that get each call (CRM log, Slack…)
  webhook: string;
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

export type EndReason = "caller_hung_up" | "agent_ended" | "transferred" | "no_answer" | "voicemail" | "busy" | "failed";

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
  checkResults?: Record<string, "success" | "failure" | "unknown">;
  live?: boolean; // the call is happening right now
  // Judged after every answered call (Analytics):
  lead?: "qualified" | "potential" | "unqualified"; // strong intent / some interest / none
  engagement?: "high" | "medium" | "low"; // asked questions / brief replies / passive
  transferTo?: "person" | "agent"; // a transfer went to a person, or was routed to another agent
  test?: boolean; // the owner trying the agent from the editor (left out of analytics)
  path?: string[]; // the workflow steps a real call walked, in order
  missing?: string[]; // required answers the call didn't get (labels)
}

// ---- Workspace ----

/** A connected tool (catalog in lib/integrations.ts). Only connected ones are stored. */
export interface Integration {
  id: string;
  connected: boolean;
  account?: string; // which account, e.g. "northside-motors.hubspot.com"
  connectedAt?: string;
  /** A calendar: the event type calls book into. */
  eventType?: { id: number; name: string; minutes: number } | null;
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

/** A phone number the workspace has. Which agent uses it lives on the agent (`Flow.numberId`). */
export interface PhoneNumber {
  id: string;
  e164: string;
  display: string; // as written locally, e.g. "(02) 5550 1234"
  country: string; // AU, NZ, US, CA, GB
  kind: "local" | "mobile" | "tollfree";
  area?: string;
  addedAt: string;
}

export interface AppState {
  version: number;
  edited?: boolean; // someone changed it since it was the sample (a newer version keeps it)
  flows: Flow[];
  numbers: PhoneNumber[];
  knowledge: KnowledgeDoc[];
  contacts: Contact[];
  fieldDefs: FieldDef[];
  sources: DataSource[];
  campaigns: Campaign[];
  calls: Call[];
  integrations: Integration[];
  settings: WorkspaceSettings;
}
