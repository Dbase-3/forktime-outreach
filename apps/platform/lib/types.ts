// The platform's data model. Iteration 1 keeps it in the browser (lib/store.ts);
// the same shapes move to the database when the backend lands.

export type Direction = "inbound" | "outbound" | "both";

// ---- Flows: what a call does ----

export type AnswerType = "text" | "yesno" | "number" | "date" | "choice";

export type ConditionOp = "is" | "is_not" | "contains" | "more_than" | "less_than" | "is_yes" | "is_no" | "is_empty" | "is_set";

export interface Condition {
  field: string;
  op: ConditionOp;
  value?: string;
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
  knowledge: string; // plain text the agent may answer from
  updatedAt: string;
}

// ---- Contacts ----

export type FieldType = "text" | "number" | "date" | "yesno" | "choice";

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
}

export interface Contact {
  id: string;
  name: string;
  phone: string;
  email?: string;
  groups: string[];
  fields: Record<string, string>;
  createdAt: string;
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
  transcript: { who: "agent" | "caller"; text: string }[];
}

// ---- Workspace ----

export interface Integration {
  id: "hubspot" | "gohighlevel" | "calcom" | "google_calendar" | "zapier" | "webhook";
  connected: boolean;
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
  automations: Automation[];
  contacts: Contact[];
  fieldDefs: FieldDef[];
  campaigns: Campaign[];
  calls: Call[];
  integrations: Integration[];
  settings: WorkspaceSettings;
}
