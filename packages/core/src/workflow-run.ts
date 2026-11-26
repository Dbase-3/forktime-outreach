// Where a live call is in its workflow. Pure: the agent calls `nextStep` after
// every saved answer and every action, and says what it returns.
//
// It walks the workflow from the top each time, using the answers saved so far
// and the steps already done. So a corrected answer re-routes the branches, and
// a question answered early is skipped when the call gets to it. The model never
// chooses the next step: it only notes answers and words the lines.

import { conditionHolds } from "./automation";
import { fill } from "./variables";
import type { Step } from "./types";

export type AskStep = Extract<Step, { kind: "ask" }>;
export type ActionStep = Extract<Step, { kind: "action" }>;
export type EndStep = Extract<Step, { kind: "end" }>;

export type Next =
  | { kind: "ask"; step: AskStep; question: string }
  | { kind: "action"; step: ActionStep; detail: string }
  | { kind: "end"; step: EndStep; text: string }
  | { kind: "no_ending" };

export interface Position {
  /** Lines to say before the next step ("say" steps reached and not said yet), filled in. */
  say: { id: string; text: string }[];
  next: Next;
  /** Every step walked to get here, in order (ids). */
  path: string[];
}

const answered = (values: Record<string, string>, field: string) => (values[field] ?? "").trim() !== "";

export function nextStep(steps: Step[], values: Record<string, string>, done: ReadonlySet<string> = new Set(), now = new Date()): Position {
  const queue = [...steps];
  const say: Position["say"] = [];
  const path: string[] = [];
  while (queue.length) {
    const step = queue.shift() as Step;
    path.push(step.id);
    if (step.kind === "say") {
      if (!done.has(step.id)) say.push({ id: step.id, text: fill(step.text, values) });
    } else if (step.kind === "ask") {
      if (!step.field || !answered(values, step.field)) return { say, next: { kind: "ask", step, question: fill(step.question, values) }, path };
    } else if (step.kind === "branch") {
      queue.unshift(...(conditionHolds(step.condition, values, now) ? step.yes : step.no));
    } else if (step.kind === "action") {
      if (!done.has(step.id)) return { say, next: { kind: "action", step, detail: fill(step.detail, values) }, path };
    } else if (step.kind === "end") {
      return { say, next: { kind: "end", step, text: fill(step.text, values) }, path };
    }
  }
  return { say, next: { kind: "no_ending" }, path };
}

const FORMAT: Record<AskStep["answerType"], string> = {
  text: "their answer in a few words",
  yesno: "Yes or No",
  number: "digits only",
  date: "a date as YYYY-MM-DD",
  choice: "one of the options",
};

/** How an Ask step's answer is saved, in words for the model. */
export function answerFormat(step: Pick<AskStep, "answerType" | "choices">): string {
  if (step.answerType === "choice" && step.choices?.length) return `one of: ${step.choices.join(", ")}`;
  return FORMAT[step.answerType];
}

/** The position in words for the model: what to say, then what to ask. Actions and endings are run by the call, not the model. */
export function describePosition(position: Position): string {
  const parts: string[] = [];
  if (position.say.length) parts.push(`Say: "${position.say.map((s) => s.text).join(" ")}"`);
  const next = position.next;
  if (next.kind === "ask") parts.push(`Ask: "${next.question}" Save the answer with note, field "${next.step.field}" (${answerFormat(next.step)}).`);
  else if (next.kind === "no_ending") parts.push("The workflow has no more steps. Help with anything else they need, then call end_call.");
  return parts.join(" Then ") || "Nothing to say right now.";
}
