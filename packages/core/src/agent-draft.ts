// "Describe your agent": the shape Claude writes an agent in, and how a draft
// becomes a real agent. The prompt holds who the agent is (persona, tone,
// rules); the workflow holds the steps. Structured outputs can't recurse, so
// decisions nest two levels deep, which covers every real call we've drawn.

import { z } from "zod";
import { newId } from "./flow-tree";
import { OPS } from "./conditions";
import { greetingIsHonest } from "./disclosure";
import { AVAILABLE_INTEGRATIONS } from "./integrations";
import { CRMS, isBookingCalendar } from "./calendar";

const isCrm = (id: string) => (CRMS as readonly string[]).includes(id);
import type { ConditionOp, DataField, Direction, FieldType, Flow, Step, SuccessCheck } from "./types";

const OP_KEYS = Object.keys(OPS) as [ConditionOp, ...ConditionOp[]];
const FIELD_TYPES = ["text", "number", "date", "yesno", "choice", "phone", "email"] as const;

const say = z.object({ kind: z.literal("say"), text: z.string() });
const ask = z.object({
  kind: z.literal("ask"),
  question: z.string(),
  field: z.string().describe("snake_case key the answer is saved under"),
  answerType: z.enum(["text", "yesno", "number", "date", "choice"]),
  choices: z.array(z.string()).describe("only for answerType choice; otherwise empty"),
});
// What an action can run on: the tools that really connect, a webhook, or nothing ("").
const LINKS = ["", "webhook", ...AVAILABLE_INTEGRATIONS.map((i) => i.id)] as [string, ...string[]];
// What runs once the call is over, however it ended (owner 2026-11-28: a CRM save as the last
// step never ran when the caller hung up before reaching it).
const AFTER_LINKS = ["webhook", ...AVAILABLE_INTEGRATIONS.map((i) => i.id)] as [string, ...string[]];
const afterCall = z.object({ kind: z.enum(["save_contact", "send_webhook"]), integration: z.enum(AFTER_LINKS).describe("the CRM to save to, or webhook"), detail: z.string().describe("in plain words; for a webhook, the URL") });
const action = z.object({ kind: z.literal("action"), action: z.enum(["book", "transfer", "text", "crm", "webhook"]), detail: z.string(), integration: z.enum(LINKS).describe("the tool it runs on, from the list you're given; empty for none") });
const end = z.object({ kind: z.literal("end"), outcome: z.string().describe("snake_case result, e.g. meeting_booked"), text: z.string() });
const condition = z.object({ field: z.string(), op: z.enum(OP_KEYS), value: z.string().describe("empty for is_yes, is_no, is_set, is_empty") });

const leaf = z.discriminatedUnion("kind", [say, ask, action, end]);
const innerBranch = z.object({ kind: z.literal("branch"), condition, yes: z.array(leaf), no: z.array(leaf) });
const middle = z.discriminatedUnion("kind", [say, ask, action, end, innerBranch]);
const topBranch = z.object({ kind: z.literal("branch"), condition, yes: z.array(middle), no: z.array(middle) });
const top = z.discriminatedUnion("kind", [say, ask, action, end, topBranch]);

export const WorkflowDraft = z.object({ steps: z.array(top) });

export const AgentDraft = z.object({
  name: z.string().describe("2 to 4 words"),
  summary: z.string().describe("one sentence: what the agent does"),
  direction: z.enum(["outbound", "inbound", "both"]),
  greeting: z.string(),
  prompt: z.string(),
  steps: z.array(top),
  dataFields: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      type: z.enum(FIELD_TYPES),
      description: z.string(),
      required: z.boolean(),
    }),
  ),
  checks: z.array(z.object({ label: z.string(), description: z.string() })),
  afterCall: z.array(afterCall),
  agentName: z.string().describe("the name the agent calls itself on calls, if the owner gave one (like Sara); otherwise empty"),
  business: z.string().describe("the company the agent speaks for, only if the owner named one other than the Business; otherwise empty"),
});

export type AgentDraftT = z.infer<typeof AgentDraft>;
type DraftStep = z.infer<typeof top>;

/** "Preferred Day!" -> "preferred_day". */
export function fieldKey(raw: string): string {
  const key = raw.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return /^[a-z]/.test(key) ? key : `f_${key || "answer"}`;
}

/** Draft steps -> real steps with ids, clean keys and no empty extras. */
export function toSteps(steps: DraftStep[]): Step[] {
  return steps.map((s): Step => {
    switch (s.kind) {
      case "say":
        return { id: newId(), kind: "say", text: s.text.trim() };
      case "ask": {
        const choices = s.choices.map((c) => c.trim()).filter(Boolean);
        return {
          id: newId(),
          kind: "ask",
          question: s.question.trim(),
          field: fieldKey(s.field),
          answerType: s.answerType === "choice" && choices.length < 2 ? "text" : s.answerType,
          ...(s.answerType === "choice" && choices.length >= 2 ? { choices } : {}),
        };
      }
      case "action":
        return { id: newId(), kind: "action", action: s.action, detail: s.detail.trim(), ...(s.integration ? { integration: s.integration } : {}) };
      case "end":
        return { id: newId(), kind: "end", outcome: fieldKey(s.outcome || "done"), text: s.text.trim() };
      case "branch": {
        const value = s.condition.value.trim();
        return {
          id: newId(),
          kind: "branch",
          condition: { field: fieldKey(s.condition.field), op: s.condition.op, ...(value ? { value } : {}) },
          yes: toSteps(s.yes as DraftStep[]),
          no: toSteps(s.no as DraftStep[]),
        };
      }
    }
  });
}

export { greetingIsHonest } from "./disclosure";

export function honestGreeting(greeting: string, direction: Direction): string {
  if (greetingIsHonest(greeting)) return greeting.trim();
  return direction === "inbound"
    ? "Thanks for calling {business}, this is {agent}, the AI assistant. This call is recorded. How can I help?"
    : "Hi {first_name}, this is {agent}, the AI assistant at {business}. This call is recorded. Have you got a minute?";
}

function askFields(steps: Step[]): Set<string> {
  const keys = new Set<string>();
  const walk = (list: Step[]) =>
    list.forEach((s) => {
      if (s.kind === "ask") keys.add(s.field);
      if (s.kind === "branch") {
        walk(s.yes);
        walk(s.no);
      }
    });
  walk(steps);
  return keys;
}

/** The parts of an agent a draft fills in, plus the name it uses on calls when the owner gave one (it goes on the voice). */
export type DraftParts = Pick<Flow, "name" | "description" | "direction" | "greeting" | "prompt" | "steps" | "dataFields" | "checks" | "business" | "afterCall"> & { agentName?: string };

export function applyDraft(draft: AgentDraftT): DraftParts {
  const steps = toSteps(draft.steps);
  const asked = askFields(steps);
  const seen = new Set<string>();
  const dataFields: DataField[] = draft.dataFields.flatMap((f) => {
    const key = fieldKey(f.key);
    if (asked.has(key) || seen.has(key)) return [];
    seen.add(key);
    return [{ key, label: f.label.trim() || key, type: f.type as FieldType, description: f.description.trim(), required: f.required }];
  });
  const checks: SuccessCheck[] = draft.checks.filter((c) => c.label.trim()).map((c) => ({ id: newId("c"), label: c.label.trim(), description: c.description.trim() }));
  const agentName = (draft.agentName ?? "").trim().slice(0, 60);
  return {
    ...(agentName ? { agentName } : {}),
    business: (draft.business ?? "").trim().slice(0, 120),
    name: draft.name.trim() || "New agent",
    description: draft.summary.trim(),
    direction: draft.direction,
    greeting: honestGreeting(draft.greeting, draft.direction),
    prompt: draft.prompt.trim(),
    steps,
    dataFields,
    checks,
    afterCall: (draft.afterCall ?? []).map((a) => ({ id: newId("ac"), kind: a.kind, integration: a.integration, fields: [], detail: a.detail.trim() })),
  };
}

/** What Claude is told about the product. Stable text, so it caches. */
export const DRAFT_SYSTEM = `You design phone agents for a self-serve AI calling product. Small businesses describe what they want in a sentence or two; you write the agent.

An agent has two parts, and they must not repeat each other:
1. prompt: who the agent is and how it behaves. Write it to the agent in the second person ("You are {agent}, the AI assistant at {business}..."). Cover: role and goal in one or two lines, tone, and 3 to 6 short rules and guardrails (what it must never say or promise, when to hand over to a person, how to handle "not interested" or "stop calling": apologise and end the call). No step-by-step script here; the workflow holds the steps. Plain words, under 180 words.
2. steps: the workflow the call follows, as a tree.
   - say: a line the agent says.
   - ask: a question; the answer is saved under field (snake_case). answerType is text, yesno, number, date or choice (give 2 to 5 choices for choice, otherwise an empty list).
   - branch: a decision on a field saved earlier by an ask, or on a contact field. Use is_yes / is_no for yesno answers, is / any_of for choices, less_than / more_than for numbers, before / after for dates. value is empty for is_yes, is_no, is_set, is_empty. Each side is a list of steps; a side may be empty (the call carries on after the branch).
   - action: book (calendar), transfer (to a person), text (send an SMS), crm (save or flag in the CRM), webhook. detail says what, in a few words. integration is the tool it runs on, from the Tools list you're given: link every book step to a calendar and every crm step to a CRM there (the one the owner names, or the only one that fits); leave it empty when nothing fits, and for transfer and text.
   - Saving the person to a CRM once the call is over ("save them to GoHighLevel", "log it in Twenty") is an afterCall save_contact, never a crm step at the end of the workflow: a call that ends early would never reach that step. Use a crm step only for something to do at that exact point of the call.
   - Booking on a calendar: the book step itself finds free times, offers them, agrees one with the caller and books it. So don't put an ask for the day or time before it, and never a say after it claiming it's booked (the call confirms the real booking).
   - A date answer holds a day only, never a time of day.
   - end: the call ends with this line; outcome is a snake_case result such as meeting_booked or not_interested.
   Keep it to the main path: 4 to 12 steps in total, one question at a time, and every path finishes with an end step.

greeting: the first thing said. It MUST say the agent is an AI assistant and that the call is recorded. Use {agent} for the agent's name and {business} for the business. For calls we make, greet the person by {first_name} when it makes sense.

agentName: if the owner names the agent (like "an agent named Sara"), put that name here; it becomes the name the voice uses, and {agent} says it. Otherwise leave it empty.

business: if the owner says the agent represents a company or brand other than the Business named below (an agency building for a client, say), put that company's name here; {business} then says it on calls. Otherwise leave it empty. Either way, write {business} in the greeting, prompt and steps, never a company name.

You may use contact fields in braces, like {first_name}, in any line, but only fields from the list you are given.

afterCall: what runs once the call is over, however it ended: save_contact to a CRM from the Tools list, or send_webhook to their URL. Often empty.

dataFields: extra facts to pull from the conversation that no ask step already saves (often none). checks: 1 to 3 ways to judge whether a call did its job.

direction: outbound if the agent makes calls, inbound if it answers them, both if it does both.

Write in the language the owner writes in. Natural, short spoken sentences; nothing a person would not say on the phone.`;

export interface DraftRequest {
  mode: "agent" | "workflow";
  brief: string;
  business: string;
  fields: { key: string; label: string; type: string }[];
  /** Ids of the tools the workspace has connected (the list of tools is the available ones). */
  connected?: string[];
  /** Workflow mode: the agent as it is now. */
  agent?: { name: string; prompt: string; greeting: string; direction: Direction };
}

export function draftUserMessage(req: DraftRequest): string {
  const fields = req.fields.length ? req.fields.map((f) => `- {${f.key}}: ${f.label} (${f.type})`).join("\n") : "(none)";
  const have = new Set(req.connected ?? []);
  const tools = AVAILABLE_INTEGRATIONS.map((i) => `- ${i.id}: ${i.name} (${[isCrm(i.id) ? "CRM" : "", isBookingCalendar(i.id) ? "calendar" : ""].filter(Boolean).join(" and ")}${have.has(i.id) ? ", connected" : ", not connected yet"})`).join("\n");
  const head = `Business: ${req.business || "(not named)"}\n\nContact fields you may use:\n- {first_name}: First name (text)\n${fields}\n\nTools (for an action's integration):\n${tools}\n- webhook: their own URL`;
  if (req.mode === "workflow" && req.agent) {
    return `${head}\n\nRebuild only the workflow (steps) for this existing agent. Keep it consistent with its prompt and greeting, and don't repeat the greeting as a step.\n\nName: ${req.agent.name}\nUsed for: ${req.agent.direction}\nGreeting: ${req.agent.greeting}\n\nPrompt:\n${req.agent.prompt}\n\nWhat the owner asked for:\n${req.brief || "(nothing more)"}`;
  }
  return `${head}\n\nWhat the owner wants:\n${req.brief}`;
}
