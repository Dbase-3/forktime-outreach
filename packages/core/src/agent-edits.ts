// Small, checked changes to an agent, each with a line in plain words saying
// what it did. "Change with AI" (apps/api builder) makes every change through
// these, so the AI can't leave a broken agent, and the owner sees exactly what
// changed. Pure.

import { ACTION_LABELS } from "./action-labels";
import { findStep, insertStep, newId, removeStep, toFieldKey, updateStep, type Container } from "./flow-tree";
import { AFTER_CALL_LABELS, integrationName } from "./connections";
import type { ActionKind, AfterCallAction, AgentTool, AnswerType, Condition, DataField, Flow, Step, SuccessCheck } from "./types";

export type EditableAgent = Pick<Flow, "name" | "description" | "direction" | "agent" | "greeting" | "business" | "prompt" | "steps" | "dataFields" | "askRequired" | "checks" | "tools" | "knowledgeIds" | "afterCall">;

export interface Edit<A = EditableAgent> {
  agent: A;
  said: string; // what changed, for the owner
}

export class EditError extends Error {}

export { AFTER_CALL_LABELS, integrationName, missingIntegrations, needsConnection, type Missing } from "./connections";

// ---- Steps ----

/** Where to put a new step. */
export type Where = { after: string } | { before: string } | { inside: string; side: "yes" | "no" } | { at: "start" | "end" };

/** A step as the AI writes it: no ids; a decision may hold its own steps. */
export type StepInput =
  | { kind: "say"; text: string }
  | { kind: "ask"; question: string; field: string; answerType: AnswerType; choices?: string[]; required?: boolean }
  | { kind: "branch"; condition: Condition; yes?: StepInput[]; no?: StepInput[] }
  | { kind: "action"; action: ActionKind; detail: string; integration?: string }
  | { kind: "end"; outcome: string; text: string };

function build(input: StepInput, required: Record<string, boolean>): Step {
  const id = newId();
  if (input.kind === "say") return { id, kind: "say", text: input.text.trim() };
  if (input.kind === "ask") {
    const field = toFieldKey(input.field) || toFieldKey(input.question);
    if (input.required === false) required[field] = false;
    return { id, kind: "ask", question: input.question.trim(), field, answerType: input.answerType, ...(input.choices?.length ? { choices: input.choices } : {}) };
  }
  if (input.kind === "branch") return { id, kind: "branch", condition: input.condition, yes: (input.yes ?? []).map((s) => build(s, required)), no: (input.no ?? []).map((s) => build(s, required)) };
  if (input.kind === "action") return { id, kind: "action", action: input.action, detail: input.detail.trim(), ...(input.integration ? { integration: input.integration } : {}) };
  return { id, kind: "end", outcome: toFieldKey(input.outcome) || "done", text: input.text.trim() };
}

/** The list a step sits in, and its place there. */
function locate(steps: Step[], id: string, container: Container = { branchId: null }): { container: Container; index: number } | null {
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (s.id === id) return { container, index: i };
    if (s.kind === "branch") {
      const found = locate(s.yes, id, { branchId: s.id, side: "yes" }) ?? locate(s.no, id, { branchId: s.id, side: "no" });
      if (found) return found;
    }
  }
  return null;
}

/** One line naming a step, for the owner. */
export function describeStep(s: Step): string {
  if (s.kind === "say") return `Say “${clip(s.text)}”`;
  if (s.kind === "ask") return `Ask “${clip(s.question)}”`;
  if (s.kind === "branch") return `Decide on ${s.condition.field.replace(/_/g, " ")}`;
  if (s.kind === "action") return `${ACTION_LABELS[s.action]}${s.integration && s.integration !== "webhook" ? ` (${integrationName(s.integration)})` : ""}${s.detail ? `: ${clip(s.detail, 50)}` : ""}`;
  return `End the call (${s.outcome.replace(/_/g, " ")})`;
}
const clip = (t: string, n = 60) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);

export function addStep<A extends EditableAgent>(agent: A, where: Where, input: StepInput): Edit<A> {
  const askRequired = { ...agent.askRequired };
  const step = build(input, askRequired);
  let container: Container = { branchId: null };
  let index = 0;
  if ("at" in where) index = where.at === "start" ? 0 : agent.steps.length;
  else if ("inside" in where) {
    const b = findStep(agent.steps, where.inside);
    if (!b || b.kind !== "branch") throw new EditError(`There's no decision with id ${where.inside}.`);
    container = { branchId: b.id, side: where.side };
    index = b[where.side].length;
  } else {
    const ref = "after" in where ? where.after : where.before;
    const found = locate(agent.steps, ref);
    if (!found) throw new EditError(`There's no step with id ${ref}.`);
    container = found.container;
    index = found.index + ("after" in where ? 1 : 0);
  }
  return { agent: { ...agent, steps: insertStep(agent.steps, container, index, step), askRequired }, said: `Added a step: ${describeStep(step)}` };
}

/** Changes a step's own settings (not its kind; a decision keeps its sides). */
export function changeStep<A extends EditableAgent>(agent: A, id: string, patch: Record<string, unknown>): Edit<A> {
  const current = findStep(agent.steps, id);
  if (!current) throw new EditError(`There's no step with id ${id}.`);
  const allowed: Record<Step["kind"], string[]> = { say: ["text"], ask: ["question", "field", "answerType", "choices"], branch: ["condition"], action: ["action", "detail", "integration"], end: ["outcome", "text"] };
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) if (allowed[current.kind].includes(k) && v !== undefined) clean[k] = k === "field" || k === "outcome" ? toFieldKey(String(v)) : v;
  if (!Object.keys(clean).length) throw new EditError(`Nothing to change on that ${current.kind} step.`);
  // A different action keeps its integration only if one was given with it.
  if (current.kind === "action" && clean.action && clean.action !== current.action && !("integration" in clean)) clean.integration = undefined;
  const steps = updateStep(agent.steps, id, clean as Partial<Step>);
  return { agent: { ...agent, steps }, said: `Changed a step: ${describeStep(findStep(steps, id) as Step)}` };
}

export function deleteStep<A extends EditableAgent>(agent: A, id: string): Edit<A> {
  const current = findStep(agent.steps, id);
  if (!current) throw new EditError(`There's no step with id ${id}.`);
  return { agent: { ...agent, steps: removeStep(agent.steps, id) }, said: `Removed a step: ${describeStep(current)}${current.kind === "branch" ? " (and the steps inside it)" : ""}` };
}

// ---- The rest of the agent ----

export function setData<A extends EditableAgent>(agent: A, field: Omit<DataField, "key"> & { key?: string }): Edit<A> {
  const key = toFieldKey(field.key || field.label);
  if (!key) throw new EditError("Name the field.");
  const exists = agent.dataFields.some((f) => f.key === key);
  const next: DataField = { ...field, key };
  return { agent: { ...agent, dataFields: exists ? agent.dataFields.map((f) => (f.key === key ? next : f)) : [...agent.dataFields, next] }, said: `${exists ? "Changed" : "Now listens for"} “${field.label}”${field.required ? " (required)" : ""}` };
}

export function removeData<A extends EditableAgent>(agent: A, key: string): Edit<A> {
  const f = agent.dataFields.find((d) => d.key === key);
  if (!f) throw new EditError(`There's no field ${key}.`);
  return { agent: { ...agent, dataFields: agent.dataFields.filter((d) => d.key !== key) }, said: `Stopped listening for “${f.label}”` };
}

export function addAfterCall<A extends EditableAgent>(agent: A, a: Omit<AfterCallAction, "id">): Edit<A> {
  const action: AfterCallAction = { ...a, id: newId("ac") };
  const to = a.integration === "webhook" ? "your URL" : integrationName(a.integration);
  return { agent: { ...agent, afterCall: [...(agent.afterCall ?? []), action] }, said: `After the call: ${AFTER_CALL_LABELS[a.kind].toLowerCase()} in ${to}${a.fields.length ? ` (${a.fields.join(", ")})` : ""}` };
}

export function removeAfterCall<A extends EditableAgent>(agent: A, id: string): Edit<A> {
  const a = (agent.afterCall ?? []).find((x) => x.id === id);
  if (!a) throw new EditError(`There's no after-call action ${id}.`);
  return { agent: { ...agent, afterCall: (agent.afterCall ?? []).filter((x) => x.id !== id) }, said: `Removed: after the call, ${AFTER_CALL_LABELS[a.kind].toLowerCase()} in ${integrationName(a.integration)}` };
}

export function addTool<A extends EditableAgent>(agent: A, t: Omit<AgentTool, "id">): Edit<A> {
  return { agent: { ...agent, tools: [...agent.tools, { ...t, id: newId("t") }] }, said: `Added a tool: ${t.name}${t.integration ? ` (${integrationName(t.integration)})` : ""}` };
}

export function setCheck<A extends EditableAgent>(agent: A, c: Omit<SuccessCheck, "id">): Edit<A> {
  const same = agent.checks.find((x) => x.label.toLowerCase() === c.label.toLowerCase());
  return { agent: { ...agent, checks: same ? agent.checks.map((x) => (x === same ? { ...x, ...c } : x)) : [...agent.checks, { ...c, id: newId("c") }] }, said: `${same ? "Changed" : "Added"} a success check: ${c.label}` };
}
