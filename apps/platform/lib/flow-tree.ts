// Pure operations on a flow's step tree. Steps live in lists; a branch step
// holds two more lists (yes / no). Every operation returns a new tree.

import type { ActionKind, Flow, Step, StepKind } from "./types";

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

/**
 * Things that would make the call go wrong. `knownFields` are the contact's own
 * fields, which a branch may test without the call asking for them.
 */
export function flowIssues(flow: Pick<Flow, "steps" | "greeting">, knownFields: string[] = []): FlowIssue[] {
  const issues: FlowIssue[] = [];
  if (!flow.greeting.trim()) issues.push({ stepId: null, message: "Add what the agent says first." });
  if (flow.steps.length === 0) issues.push({ stepId: null, message: "Add at least one step." });
  const fields = new Set([...askedFields(flow.steps), ...knownFields]);
  for (const step of allSteps(flow.steps)) issues.push(...stepIssues(step, fields));
  issues.push(...unreachable(flow.steps));
  return issues;
}

function stepIssues(step: Step, fields: Set<string>): FlowIssue[] {
  const issue = (message: string) => [{ stepId: step.id, message }];
  if (step.kind === "say" && !step.text.trim()) return issue("Write what the agent says.");
  if (step.kind === "ask" && !step.question.trim()) return issue("Write the question.");
  if (step.kind === "ask" && !step.field.trim()) return issue("Name where the answer is saved.");
  if (step.kind === "ask" && step.answerType === "choice" && (step.choices ?? []).length < 2) return issue("Give at least two choices.");
  if (step.kind === "branch" && !step.condition.field) return issue("Pick what this decision checks.");
  if (step.kind === "branch" && !fields.has(step.condition.field)) return issue(`"${step.condition.field}" is never asked or known.`);
  if (step.kind === "end" && !step.outcome.trim()) return issue("Name the outcome.");
  return [];
}

/** Steps placed after an ending in the same list can never run. */
function unreachable(steps: Step[]): FlowIssue[] {
  const issues: FlowIssue[] = [];
  const endAt = steps.findIndex((step) => step.kind === "end");
  if (endAt !== -1 && endAt < steps.length - 1) {
    issues.push({ stepId: steps[endAt + 1].id, message: "This step comes after the call has ended." });
  }
  for (const step of steps) {
    if (step.kind === "branch") issues.push(...unreachable(step.yes), ...unreachable(step.no));
  }
  return issues;
}
