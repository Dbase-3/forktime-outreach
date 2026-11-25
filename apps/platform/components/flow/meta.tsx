// How each kind of step looks and reads in the builder.

import {
  CalendarCheck, Database, Flag, GitBranch, HelpCircle, MessageCircle, MessageSquareText, PhoneForwarded, Webhook,
  type LucideIcon,
} from "lucide-react";
import { describeCondition } from "@/lib/automation";
import { humanize } from "@/lib/format";
import type { ActionKind, AnswerType, FieldDef, Step, StepKind } from "@/lib/types";

interface Meta {
  label: string;
  icon: LucideIcon;
  tint: string; // icon tile colours
}

export const STEP_META: Record<Exclude<StepKind, "action">, Meta> = {
  say: { label: "Say", icon: MessageSquareText, tint: "bg-sky-500/10 text-sky-600 dark:text-sky-400" },
  ask: { label: "Ask", icon: HelpCircle, tint: "bg-accent/10 text-accent" },
  branch: { label: "Decide", icon: GitBranch, tint: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  end: { label: "End call", icon: Flag, tint: "bg-rose-500/10 text-rose-600 dark:text-rose-400" },
};

export const ACTION_META: Record<ActionKind, Meta & { hint: string }> = {
  book: { label: "Book on calendar", icon: CalendarCheck, tint: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400", hint: "Which calendar and how long" },
  transfer: { label: "Transfer to a person", icon: PhoneForwarded, tint: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400", hint: "Who to put them through to" },
  text: { label: "Send a text", icon: MessageCircle, tint: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400", hint: "What the text says, and to whom" },
  crm: { label: "Update CRM", icon: Database, tint: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400", hint: "What to create or change" },
  webhook: { label: "Send to webhook", icon: Webhook, tint: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400", hint: "Where the call's answers are sent" },
};

export const ANSWER_TYPES: { value: AnswerType; label: string }[] = [
  { value: "text", label: "Free text" },
  { value: "yesno", label: "Yes / No" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "choice", label: "Pick one" },
];

export function metaOf(step: Step): Meta {
  return step.kind === "action" ? ACTION_META[step.action] : STEP_META[step.kind];
}

/**
 * One line that says what a step does, for its card. `questions` maps a saved
 * field to the question that fills it, so a yes/no decision reads as
 * "If yes to “Is everything running well?”" rather than a field name.
 */
export function summarize(step: Step, defs: FieldDef[], questions: Record<string, string> = {}): string {
  if (step.kind === "say") return step.text || "Nothing to say yet";
  if (step.kind === "ask") return step.question || "No question yet";
  if (step.kind === "branch") return branchSummary(step, defs, questions);
  if (step.kind === "action") return step.detail || ACTION_META[step.action].hint;
  return step.text || humanize(step.outcome);
}

function branchSummary(step: Extract<Step, { kind: "branch" }>, defs: FieldDef[], questions: Record<string, string>): string {
  const { field, op } = step.condition;
  if (!field) return "Pick what to check";
  const question = questions[field];
  if (question && op === "is_yes") return `If yes to “${question}”`;
  if (question && op === "is_no") return `If no to “${question}”`;
  return `If ${describeCondition(step.condition, defs).replace(/^./, (c) => c.toLowerCase())}`;
}

/** The small grey note under a card: where the answer goes, the outcome, … */
export function footnote(step: Step): string | null {
  if (step.kind === "ask" && step.field) {
    const type = ANSWER_TYPES.find((t) => t.value === step.answerType)?.label ?? "";
    return `Saves to ${step.field} · ${type}`;
  }
  if (step.kind === "end") return `Outcome: ${humanize(step.outcome || "none")}`;
  return null;
}
