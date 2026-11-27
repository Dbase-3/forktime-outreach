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

/** What comes after an answer, as far as it can be known before the answer is noted. */
export type Ahead = { field: string; cases: { when: string; then: { kind: "ask"; say: string[]; question: string } | { kind: "end" } | { kind: "wait" } }[] };

/** Two different stand-in answers per type: if both lead to the same next line, the answer doesn't change it. */
const PROBES: Record<AskStep["answerType"], [string, string]> = {
  text: ["\u0001a", "\u0001zz"],
  yesno: ["Yes", "No"],
  choice: ["\u0001a", "\u0001zz"],
  number: ["0", "999999999"],
  date: ["1900-01-01", "2999-12-31"],
};

/**
 * The next line for each possible answer to the current question, so the model
 * can say it in the same reply as the note (one model round instead of two).
 * Yes/No and choices get a case each; any other answer gets one case when it
 * doesn't change what comes next. A path through an action "waits" (the action
 * runs first). Null when nothing can be said ahead.
 */
export function lookahead(steps: Step[], values: Record<string, string>, done: ReadonlySet<string>, position: Position, now = new Date()): Ahead | null {
  const next = position.next;
  if (next.kind !== "ask" || !next.step.field) return null;
  const { field, answerType, choices } = next.step;
  // Lines said before this question count as said once it's answered.
  const doneAfter = new Set([...done, ...position.say.map((s) => s.id)]);
  const predict = (value: string): Ahead["cases"][number]["then"] => {
    const p = nextStep(steps, { ...values, [field]: value }, doneAfter, now);
    if (p.next.kind === "ask") return { kind: "ask", say: p.say.map((s) => s.text), question: p.next.question };
    if (p.next.kind === "end") return { kind: "end" };
    return { kind: "wait" };
  };
  let cases: Ahead["cases"];
  if (answerType === "yesno") cases = ["Yes", "No"].map((v) => ({ when: v, then: predict(v) }));
  else if (answerType === "choice" && choices?.length && choices.length <= 6) cases = choices.map((v) => ({ when: v, then: predict(v) }));
  else {
    const [a, b] = PROBES[answerType];
    const first = predict(a);
    if (JSON.stringify(first) !== JSON.stringify(predict(b)) || JSON.stringify(first).includes("\u0001")) return null;
    cases = [{ when: "any answer", then: first }];
  }
  return cases.every((c) => c.then.kind === "wait") ? null : { field, cases };
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

const wordsOf = (text: string) => (text.toLowerCase().match(/[a-zÀ-ɏ']{4,}/g) ?? []).map((w) => w.replace(/'/g, ""));

/**
 * Whether a spoken reply asked the given question, in the model's own words:
 * most of the question's longer words are in it, and it asks something. Only
 * decides if a second model round is needed; when unsure, it says no (the old,
 * slower path).
 */
export function askedInReply(reply: string, question: string): boolean {
  if (!reply.includes("?")) return false;
  const want = [...new Set(wordsOf(question))];
  if (want.length < 2) return true;
  const have = new Set(wordsOf(reply));
  return want.filter((w) => have.has(w)).length / want.length >= 0.6;
}
