"use client";

// Editing one step, and picking a new one. Edits apply as you type.

import clsx from "clsx";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { OP_LABELS, VALUELESS_OPS, fieldLabel } from "@/lib/automation";
import { toFieldKey } from "@/lib/flow-tree";
import type { ActionKind, Condition, FieldDef, Step, StepKind } from "@/lib/types";
import { Field, Sheet } from "../ui";
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
  defs: FieldDef[];
  askedFields: string[];
  onChange: (patch: Partial<Step>) => void;
  onMove: (delta: -1 | 1) => void;
  onDelete: () => void;
  onClose: () => void;
}

export function StepSheet({ step, defs, askedFields, onChange, onMove, onDelete, onClose }: EditProps) {
  const title = step ? metaOf(step).label : "";
  return (
    <Sheet
      open={step !== null}
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
      {step && <StepForm step={step} defs={defs} askedFields={askedFields} onChange={onChange} />}
    </Sheet>
  );
}

const PLACEHOLDER_HINT = "Use {first_name} or any contact field in curly brackets.";

function StepForm({ step, defs, askedFields, onChange }: { step: Step; defs: FieldDef[]; askedFields: string[]; onChange: (patch: Partial<Step>) => void }) {
  if (step.kind === "say") {
    return (
      <Field label="The agent says" hint={PLACEHOLDER_HINT}>
        <textarea className="field min-h-28" value={step.text} autoFocus onChange={(e) => onChange({ text: e.target.value })} />
      </Field>
    );
  }
  if (step.kind === "ask") return <AskForm step={step} onChange={onChange} />;
  if (step.kind === "branch") return <BranchForm step={step} defs={defs} askedFields={askedFields} onChange={onChange} />;
  if (step.kind === "action") return <ActionForm step={step} onChange={onChange} />;
  return (
    <div className="space-y-4">
      <Field label="Goodbye line">
        <textarea className="field min-h-20" value={step.text} onChange={(e) => onChange({ text: e.target.value })} />
      </Field>
      <Field label="Outcome" hint="How this call is filed. Automations can act on it, e.g. call again in 3 months.">
        <input className="field" value={step.outcome} onChange={(e) => onChange({ outcome: toFieldKey(e.target.value) || "" })} placeholder="e.g. service_booked" />
      </Field>
    </div>
  );
}

function AskForm({ step, onChange }: { step: Extract<Step, { kind: "ask" }>; onChange: (patch: Partial<Step>) => void }) {
  const suggestField = () => {
    if (step.field || !step.question.trim()) return;
    onChange({ field: toFieldKey(step.question.split(/\s+/).slice(-3).join(" ")) });
  };
  return (
    <div className="space-y-5">
      <Field label="Question" hint="The agent asks it in its own words if the caller has already answered part of it.">
        <textarea className="field min-h-20" value={step.question} autoFocus onBlur={suggestField} onChange={(e) => onChange({ question: e.target.value })} />
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
      <Field label="Save the answer as" hint="Decisions, automations and your CRM use this name.">
        <input className="field font-mono text-sm" value={step.field} onChange={(e) => onChange({ field: toFieldKey(e.target.value) })} placeholder="e.g. wants_service" />
      </Field>
    </div>
  );
}

function BranchForm({ step, defs, askedFields, onChange }: { step: Extract<Step, { kind: "branch" }>; defs: FieldDef[]; askedFields: string[]; onChange: (patch: Partial<Step>) => void }) {
  const setCondition = (patch: Partial<Condition>) => onChange({ condition: { ...step.condition, ...patch } });
  const options = [...new Set([...askedFields, ...defs.map((d) => d.key)])];
  const needsValue = !VALUELESS_OPS.includes(step.condition.op);
  return (
    <div className="space-y-4">
      <p className="text-sm text-fg-3">The call goes down &ldquo;If yes&rdquo; when this is true, and &ldquo;Otherwise&rdquo; when it isn&rsquo;t.</p>
      <Field label="Check">
        <select className="field" value={step.condition.field} onChange={(e) => setCondition({ field: e.target.value })}>
          <option value="">Pick an answer or contact field</option>
          {askedFields.length > 0 && (
            <optgroup label="Answers from this call">
              {askedFields.map((key) => (
                <option key={key} value={key}>{key}</option>
              ))}
            </optgroup>
          )}
          <optgroup label="Contact fields">
            {options.filter((key) => !askedFields.includes(key)).map((key) => (
              <option key={key} value={key}>{fieldLabel(key, defs)}</option>
            ))}
          </optgroup>
        </select>
      </Field>
      <div className={clsx("grid gap-3", needsValue && "grid-cols-2")}>
        <Field label="Rule">
          <select className="field" value={step.condition.op} onChange={(e) => setCondition({ op: e.target.value as Condition["op"] })}>
            {Object.entries(OP_LABELS).map(([op, label]) => (
              <option key={op} value={op}>{label}</option>
            ))}
          </select>
        </Field>
        {needsValue && (
          <Field label="Value">
            <input className="field" value={step.condition.value ?? ""} onChange={(e) => setCondition({ value: e.target.value })} />
          </Field>
        )}
      </div>
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
