"use client";

// Editing one step, and picking a new one. Edits apply as you type.

import clsx from "clsx";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { fitOp } from "@outreach/core/conditions";
import { allSteps, toFieldKey } from "@outreach/core/flow-tree";
import type { ActionKind, FieldDef, Step, StepKind } from "@outreach/core/types";
import { variableGroups, type VarGroup } from "@outreach/core/variables";
import { RuleRow } from "../rules-editor";
import { VarText } from "../var-text";
import { Field, Sheet, useLastPresent } from "../ui";
import { ACTION_META, ANSWER_TYPES, STEP_META, metaOf } from "./meta";

export type NewStepChoice = { kind: StepKind; action?: ActionKind };

const ADD_CHOICES: (NewStepChoice & { label: string; hint: string })[] = [
  { kind: "say", label: "Say", hint: "The agent says something" },
  { kind: "ask", label: "Ask", hint: "Ask and save the answer" },
  { kind: "branch", label: "Decide", hint: "Go one way or another" },
  { kind: "action", action: "book", label: "Book", hint: "Put it on a calendar" },
  { kind: "action", action: "transfer", label: "Transfer", hint: "Put them through to a person" },
  { kind: "action", action: "text", label: "Send a text", hint: "SMS during or after the call" },
  { kind: "action", action: "crm", label: "Update CRM", hint: "Create or change a record" },
  { kind: "action", action: "webhook", label: "Webhook", hint: "Send answers anywhere" },
  { kind: "end", label: "End call", hint: "Say goodbye with an outcome" },
];

export function AddStepSheet({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (choice: NewStepChoice) => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Add a step">
      <div className="grid grid-cols-2 gap-2.5">
        {ADD_CHOICES.map((choice) => {
          const meta = choice.kind === "action" ? ACTION_META[choice.action ?? "book"] : STEP_META[choice.kind as Exclude<StepKind, "action">];
          const Icon = meta.icon;
          return (
            <button
              key={choice.label}
              type="button"
              onClick={() => onPick(choice)}
              className="card flex flex-col items-start gap-2 p-3.5 text-left transition hover:border-accent/50"
            >
              <span className={clsx("flex h-9 w-9 items-center justify-center rounded-lg", meta.tint)}>
                <Icon size={17} />
              </span>
              <span>
                <span className="block text-sm font-semibold">{choice.label}</span>
                <span className="block text-xs text-fg-3">{choice.hint}</span>
              </span>
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}

interface EditProps {
  step: Step | null;
  fields: FieldDef[];
  onChange: (patch: Partial<Step>) => void;
  onMove: (delta: -1 | 1) => void;
  onDelete: () => void;
  onClose: () => void;
}

export function StepSheet({ step: current, fields, onChange, onMove, onDelete, onClose }: EditProps) {
  const step = useLastPresent(current);
  const title = step ? metaOf(step).label : "";
  return (
    <Sheet
      open={current !== null}
      onClose={onClose}
      title={title}
      footer={
        <div className="flex items-center gap-2">
          <button type="button" className="btn-icon" onClick={() => onMove(-1)} aria-label="Move up">
            <ArrowUp size={18} />
          </button>
          <button type="button" className="btn-icon" onClick={() => onMove(1)} aria-label="Move down">
            <ArrowDown size={18} />
          </button>
          <button type="button" className="btn-icon text-rose-500 hover:bg-rose-500/10 hover:text-rose-600" onClick={onDelete} aria-label="Delete step">
            <Trash2 size={18} />
          </button>
          <button type="button" className="btn-primary ml-auto" onClick={onClose}>
            Done
          </button>
        </div>
      }
    >
      {step && <StepForm step={step} fields={fields} onChange={onChange} />}
    </Sheet>
  );
}

/** What a step's lines can use: the contact's fields and this call's answers (from decisionFields). */
function stepVars(fields: FieldDef[], ownField?: string): VarGroup[] {
  const isAnswer = (f: FieldDef) => f.label.startsWith("Answer: ");
  const answers = fields.filter((f) => isAnswer(f) && f.key !== ownField).map((f) => ({ key: f.key, label: f.label.replace(/^Answer: /, "").replace(/^./, (c) => c.toUpperCase()) }));
  return variableGroups(fields.filter((f) => !isAnswer(f)), answers);
}

/** The fields a decision can check: this call's answers (typed by their question) and the contact's own fields. */
export function decisionFields(steps: Step[], defs: FieldDef[]): FieldDef[] {
  const asked = allSteps(steps).flatMap((s) => (s.kind === "ask" && s.field ? [{ key: s.field, label: `Answer: ${s.field.replace(/_/g, " ")}`, type: ANSWER_FIELD[s.answerType], choices: s.choices }] : []));
  const unique = asked.filter((f, i) => asked.findIndex((x) => x.key === f.key) === i);
  return [...unique, ...defs.filter((d) => !unique.some((u) => u.key === d.key))];
}

const ANSWER_FIELD = { text: "text", yesno: "yesno", number: "number", date: "date", choice: "choice" } as const;

export function StepForm({ step, fields, onChange }: { step: Step; fields: FieldDef[]; onChange: (patch: Partial<Step>) => void }) {
  if (step.kind === "say") {
    return (
      <Field label="The agent says">
        <VarText className="field min-h-28" value={step.text} autoFocus onChange={(text) => onChange({ text })} groups={stepVars(fields)} />
      </Field>
    );
  }
  if (step.kind === "ask") return <AskForm step={step} vars={stepVars(fields, step.field)} onChange={onChange} />;
  if (step.kind === "branch") return <BranchForm step={step} fields={fields} onChange={onChange} />;
  if (step.kind === "action") return <ActionForm step={step} onChange={onChange} />;
  return (
    <div className="space-y-4">
      <Field label="Goodbye line">
        <VarText value={step.text} onChange={(text) => onChange({ text })} groups={stepVars(fields)} />
      </Field>
      <Field label="Outcome" hint="How this call is filed. Campaigns can act on it, e.g. call again in 3 months.">
        <input className="field" value={step.outcome} onChange={(e) => onChange({ outcome: toFieldKey(e.target.value) || "" })} placeholder="e.g. service_booked" />
      </Field>
    </div>
  );
}

function AskForm({ step, vars, onChange }: { step: Extract<Step, { kind: "ask" }>; vars: VarGroup[]; onChange: (patch: Partial<Step>) => void }) {
  const suggestField = () => {
    if (step.field || !step.question.trim()) return;
    onChange({ field: toFieldKey(step.question.split(/\s+/).slice(-3).join(" ")) });
  };
  return (
    <div className="space-y-5">
      <Field label="Question" hint="The agent asks it in its own words if the caller has already answered part of it.">
        <VarText value={step.question} autoFocus onBlur={suggestField} onChange={(question) => onChange({ question })} groups={vars} />
      </Field>
      <div>
        <span className="label">Answer type</span>
        <div className="flex flex-wrap gap-2">
          {ANSWER_TYPES.map((type) => (
            <button
              key={type.value}
              type="button"
              onClick={() => onChange({ answerType: type.value })}
              className={clsx("rounded-full border px-3 py-1.5 text-sm transition", step.answerType === type.value ? "border-accent bg-accent/10 text-accent" : "border-line text-fg-2 hover:bg-subtle")}
            >
              {type.label}
            </button>
          ))}
        </div>
      </div>
      {step.answerType === "choice" && (
        <Field label="Choices" hint="Separate with commas.">
          <input
            className="field"
            value={(step.choices ?? []).join(", ")}
            onChange={(e) => onChange({ choices: e.target.value.split(",").map((c) => c.trimStart()) })}
            onBlur={() => onChange({ choices: (step.choices ?? []).map((c) => c.trim()).filter(Boolean) })}
          />
        </Field>
      )}
      <Field label="Save the answer as" hint="Decisions, campaigns and your CRM use this name.">
        <input className="field font-mono text-sm" value={step.field} onChange={(e) => onChange({ field: toFieldKey(e.target.value) })} placeholder="e.g. wants_service" />
      </Field>
    </div>
  );
}

function BranchForm({ step, fields, onChange }: { step: Extract<Step, { kind: "branch" }>; fields: FieldDef[]; onChange: (patch: Partial<Step>) => void }) {
  const known = fields.some((f) => f.key === step.condition.field);
  const list = known || !step.condition.field ? fields : [{ key: step.condition.field, label: step.condition.field, type: "text" as const }, ...fields];
  return (
    <div className="space-y-4">
      <p className="text-sm text-fg-3">The call goes down &ldquo;If yes&rdquo; when this is true, and &ldquo;Otherwise&rdquo; when it isn&rsquo;t.</p>
      {list.length === 0 ? (
        <p className="text-sm text-amber-700 dark:text-amber-400">Add an Ask step before this, or a contact field, to have something to check.</p>
      ) : (
        <RuleRow rule={step.condition.field ? step.condition : { field: list[0].key, op: fitOp(step.condition.op, list[0].type) }} fields={list} onChange={(condition) => onChange({ condition })} />
      )}
    </div>
  );
}

function ActionForm({ step, onChange }: { step: Extract<Step, { kind: "action" }>; onChange: (patch: Partial<Step>) => void }) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {(Object.keys(ACTION_META) as ActionKind[]).map((kind) => {
          const meta = ACTION_META[kind];
          const Icon = meta.icon;
          return (
            <button
              key={kind}
              type="button"
              onClick={() => onChange({ action: kind })}
              className={clsx("flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left text-sm transition", step.action === kind ? "border-accent bg-accent/10 text-accent" : "border-line hover:bg-subtle")}
            >
              <Icon size={16} />
              {meta.label}
            </button>
          );
        })}
      </div>
      <Field label="Details" hint={ACTION_META[step.action].hint}>
        <textarea className="field min-h-20" value={step.detail} onChange={(e) => onChange({ detail: e.target.value })} />
      </Field>
    </div>
  );
}
