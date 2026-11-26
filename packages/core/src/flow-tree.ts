// Pure operations on a flow's step tree. Steps live in lists; a branch step
// holds two more lists (yes / no). Every operation returns a new tree.

import { greetingIsHonest } from "./disclosure";
import { OPS_FOR } from "./conditions";
import { missingIntegrations } from "./connections";
import type { ActionKind, AnswerType, FieldType, Flow, Step, StepKind } from "./types";

/** Where a list of steps lives: the flow's top level, or one side of a branch. */
export interface Container {
  branchId: string | null;
  side?: "yes" | "no";
}

export const TOP: Container = { branchId: null };

export function newId(prefix = "s"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function makeStep(kind: StepKind, action: ActionKind = "book"): Step {
  const id = newId();
  if (kind === "say") return { id, kind, text: "" };
  if (kind === "ask") return { id, kind, question: "", field: "", answerType: "text" };
  if (kind === "branch") return { id, kind, condition: { field: "", op: "is_yes" }, yes: [], no: [] };
  if (kind === "action") return { id, kind, action, detail: "" };
  return { id, kind: "end", outcome: "done", text: "Thanks for your time. Bye for now." };
}

export function findStep(steps: Step[], id: string): Step | null {
  for (const step of steps) {
    if (step.id === id) return step;
    if (step.kind !== "branch") continue;
    const found = findStep(step.yes, id) ?? findStep(step.no, id);
    if (found) return found;
  }
  return null;
}

/** Applies `fn` to the list a container points at, wherever it sits in the tree. */
function mapContainer(steps: Step[], container: Container, fn: (list: Step[]) => Step[]): Step[] {
  if (container.branchId === null) return fn(steps);
  return steps.map((step) => {
    if (step.kind !== "branch") return step;
    if (step.id === container.branchId) {
      const side = container.side ?? "yes";
      return { ...step, [side]: fn(step[side]) };
    }
    return { ...step, yes: mapContainer(step.yes, container, fn), no: mapContainer(step.no, container, fn) };
  });
}

export function insertStep(steps: Step[], container: Container, index: number, step: Step): Step[] {
  return mapContainer(steps, container, (list) => {
    const at = Math.max(0, Math.min(index, list.length));
    return [...list.slice(0, at), step, ...list.slice(at)];
  });
}

export function updateStep(steps: Step[], id: string, patch: Partial<Step>): Step[] {
  return steps.map((step) => {
    if (step.id === id) return { ...step, ...patch, id: step.id, kind: step.kind } as Step;
    if (step.kind !== "branch") return step;
    return { ...step, yes: updateStep(step.yes, id, patch), no: updateStep(step.no, id, patch) };
  });
}

export function removeStep(steps: Step[], id: string): Step[] {
  return steps
    .filter((step) => step.id !== id)
    .map((step) => (step.kind === "branch" ? { ...step, yes: removeStep(step.yes, id), no: removeStep(step.no, id) } : step));
}

/** Moves a step up (-1) or down (+1) inside its own list. Out of range = unchanged. */
export function moveStep(steps: Step[], id: string, delta: -1 | 1): Step[] {
  const at = steps.findIndex((step) => step.id === id);
  if (at !== -1) {
    const to = at + delta;
    if (to < 0 || to >= steps.length) return steps;
    const next = [...steps];
    [next[at], next[to]] = [next[to], next[at]];
    return next;
  }
  return steps.map((step) =>
    step.kind === "branch" ? { ...step, yes: moveStep(step.yes, id, delta), no: moveStep(step.no, id, delta) } : step,
  );
}

/** Every step in the tree, in reading order. */
export function allSteps(steps: Step[]): Step[] {
  return steps.flatMap((step) => (step.kind === "branch" ? [step, ...allSteps(step.yes), ...allSteps(step.no)] : [step]));
}

export function askedFields(steps: Step[]): string[] {
  const fields = allSteps(steps).flatMap((step) => (step.kind === "ask" && step.field ? [step.field] : []));
  return [...new Set(fields)];
}

export function outcomesOf(flow: Pick<Flow, "steps">): string[] {
  const outcomes = allSteps(flow.steps).flatMap((step) => (step.kind === "end" && step.outcome ? [step.outcome] : []));
  return [...new Set(outcomes)];
}

export function countSteps(steps: Step[]): number {
  return allSteps(steps).length;
}

/** Turns "Car model?" into "car_model": the key a saved answer goes under. */
export function toFieldKey(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

export interface FlowIssue {
  stepId: string | null;
  message: string;
}

/** A field a decision may test without the call asking: the contact's own, with its type when known. */
export type KnownField = string | { key: string; type: FieldType };

const ANSWER_FIELD: Record<AnswerType, FieldType> = { text: "text", yesno: "yesno", number: "number", date: "date", choice: "choice" };

/**
 * Things that would make the call go wrong. Walks every path in order, so a
 * decision that comes before its question, a path that never reaches an End,
 * an operator that doesn't fit the field's type, actions with nothing set up
 * and steps nothing can reach are all caught (bug B6). The welcome message
 * must disclose the AI and the recording (B8).
 */
export function flowIssues(flow: Pick<Flow, "steps" | "greeting"> & Partial<Pick<Flow, "tools" | "afterCall">>, knownFields: KnownField[] = [], connected?: string[]): FlowIssue[] {
  const issues: FlowIssue[] = [];
  // Something uses an integration that isn't connected: it can't go live like that (owner, 2026-11-27).
  if (connected) for (const m of missingIntegrations(flow, connected)) issues.push({ stepId: m.stepId, message: `Connect ${m.name}: ${m.where} uses it.` });
  if (!flow.greeting.trim()) issues.push({ stepId: null, message: "Add what the agent says first." });
  else if (!greetingIsHonest(flow.greeting)) issues.push({ stepId: null, message: "The welcome message must say it's an AI assistant and that the call is recorded." });
  if (flow.steps.length === 0) {
    issues.push({ stepId: null, message: "Add at least one step." });
    return issues;
  }
  const known = new Map<string, FieldType | null>(knownFields.map((f) => (typeof f === "string" ? [f, null] : [f.key, f.type])));
  const askedAnywhere = new Map<string, FieldType>();
  for (const s of allSteps(flow.steps)) if (s.kind === "ask" && s.field) askedAnywhere.set(s.field, ANSWER_FIELD[s.answerType]);

  const walk = (list: Step[], asked: Map<string, FieldType>): { ends: boolean; asked: Map<string, FieldType> } => {
    const here = new Map(asked);
    for (let i = 0; i < list.length; i++) {
      const step = list[i];
      issues.push(...stepIssues(step));
      if (step.kind === "ask" && step.field) here.set(step.field, ANSWER_FIELD[step.answerType]);
      if (step.kind === "branch" && step.condition.field) {
        const field = step.condition.field;
        const type = here.get(field) ?? (known.has(field) ? known.get(field) ?? null : undefined);
        if (type === undefined) {
          issues.push({ stepId: step.id, message: askedAnywhere.has(field) ? `This decides on "${field}" before the call asks for it.` : `"${field}" is never asked or known.` });
        } else if (type && !OPS_FOR[type].includes(step.condition.op)) {
          issues.push({ stepId: step.id, message: `"${field}" is ${type === "yesno" ? "a yes/no" : `a ${type}`} answer; pick a check that fits it.` });
        }
        const yes = walk(step.yes, here);
        const no = walk(step.no, here);
        // Only answers asked on both sides are certain afterwards.
        for (const [k, v] of yes.asked) if (no.asked.has(k)) here.set(k, v);
        if (yes.ends && no.ends) {
          if (i < list.length - 1) issues.push({ stepId: list[i + 1].id, message: "Both sides of the decision before this end the call, so it never runs." });
          return { ends: true, asked: here };
        }
      }
      if (step.kind === "end") {
        if (i < list.length - 1) issues.push({ stepId: list[i + 1].id, message: "This step comes after the call has ended." });
        return { ends: true, asked: here };
      }
    }
    return { ends: false, asked: here };
  };

  if (!walk(flow.steps, new Map()).ends) {
    issues.push({ stepId: lastLeaf(flow.steps)?.id ?? null, message: "Some calls reach the end of the workflow without an End call step. Add one so every call ends with an outcome." });
  }
  return issues;
}

/** The last step on a path that doesn't end, for pointing at. */
function lastLeaf(steps: Step[]): Step | null {
  const last = steps[steps.length - 1];
  if (!last) return null;
  if (last.kind === "branch") return lastLeaf(last.no) ?? lastLeaf(last.yes) ?? last;
  return last;
}

function stepIssues(step: Step): FlowIssue[] {
  const issue = (message: string) => [{ stepId: step.id, message }];
  if (step.kind === "say" && !step.text.trim()) return issue("Write what the agent says.");
  if (step.kind === "ask" && !step.question.trim()) return issue("Write the question.");
  if (step.kind === "ask" && !step.field.trim()) return issue("Name where the answer is saved.");
  if (step.kind === "ask" && step.answerType === "choice" && (step.choices ?? []).length < 2) return issue("Give at least two choices.");
  if (step.kind === "branch" && !step.condition.field) return issue("Pick what this decision checks.");
  if (step.kind === "action" && !step.detail.trim()) {
    const what = { book: "which calendar to book on", transfer: "who to transfer to", text: "what the text says", crm: "what to save in the CRM", webhook: "where to send the answers" }[step.action];
    return issue(`Say ${what}.`);
  }
  if (step.kind === "end" && !step.outcome.trim()) return issue("Name the outcome.");
  return [];
}
