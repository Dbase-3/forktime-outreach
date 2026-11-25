"use client";

// Building rules: field → operator (only those that fit the field's type) →
// value (a box that fits: date, number of days, list of choices…). And/Or for
// the whole group. Used for contact filters, campaign audiences and triggers.

import clsx from "clsx";
import { Plus, X } from "lucide-react";
import { OPS, OPS_FOR, defaultOp, fitOp } from "@/lib/conditions";
import type { Condition, ConditionGroup, FieldDef } from "@/lib/types";

export function RulesEditor({ group, fields, onChange, addLabel = "Add a rule", compact }: { group: ConditionGroup; fields: FieldDef[]; onChange: (g: ConditionGroup) => void; addLabel?: string; compact?: boolean }) {
  const set = (i: number, rule: Condition) => onChange({ ...group, rules: group.rules.map((r, j) => (j === i ? rule : r)) });
  const add = () => {
    const field = fields[0];
    if (!field) return;
    onChange({ ...group, rules: [...group.rules, { field: field.key, op: defaultOp(field.type) }] });
  };
  return (
    <div className="space-y-2">
      {group.rules.map((rule, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
          <span className="w-12 shrink-0 text-xs text-fg-3">
            {i === 0 ? "Where" : i === 1 ? (
              <button type="button" className="rounded-md border border-line px-1.5 py-0.5 font-medium text-fg-2 hover:border-line-strong" onClick={() => onChange({ ...group, match: group.match === "all" ? "any" : "all" })} title="Switch between And and Or">
                {group.match === "all" ? "and" : "or"}
              </button>
            ) : (
              <span className="px-1.5">{group.match === "all" ? "and" : "or"}</span>
            )}
          </span>
          <RuleRow rule={rule} fields={fields} onChange={(r) => set(i, r)} compact={compact} />
          <button type="button" className="btn-icon h-8 w-8 shrink-0" onClick={() => onChange({ ...group, rules: group.rules.filter((_, j) => j !== i) })} aria-label="Remove rule">
            <X size={14} />
          </button>
        </div>
      ))}
      <button type="button" className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm text-fg-3 transition-colors hover:bg-muted hover:text-fg" onClick={add}>
        <Plus size={14} /> {addLabel}
      </button>
    </div>
  );
}

export function RuleRow({ rule, fields, onChange, compact }: { rule: Condition; fields: FieldDef[]; onChange: (r: Condition) => void; compact?: boolean }) {
  const field = fields.find((f) => f.key === rule.field) ?? fields[0];
  const type = field?.type ?? "text";
  const input = OPS[rule.op].input;
  const box = clsx("field h-8 py-0 text-sm", compact && "sm:text-xs");
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 sm:flex-nowrap">
      <select
        className={clsx(box, "w-full sm:w-40")}
        value={field?.key ?? ""}
        onChange={(e) => {
          const next = fields.find((f) => f.key === e.target.value);
          onChange({ field: e.target.value, op: fitOp(rule.op, next?.type ?? "text") });
        }}
        aria-label="Field"
      >
        {fields.map((f) => (
          <option key={f.key} value={f.key}>{f.label}</option>
        ))}
      </select>
      <select className={clsx(box, "w-full sm:w-auto")} value={rule.op} onChange={(e) => onChange({ field: rule.field, op: e.target.value as Condition["op"] })} aria-label="Rule">
        {OPS_FOR[type].map((op) => (
          <option key={op} value={op}>{OPS[op].label.replace(" … ", " N ")}</option>
        ))}
      </select>
      {input === "value" && (
        <input
          className={clsx(box, "w-full min-w-0 sm:flex-1")}
          type={type === "date" ? "date" : type === "number" ? "number" : "text"}
          value={rule.value ?? ""}
          onChange={(e) => onChange({ ...rule, value: e.target.value })}
          placeholder="Value"
          aria-label="Value"
        />
      )}
      {input === "days" && (
        <span className="flex w-full items-center gap-2 sm:w-auto">
          <input className={clsx(box, "w-20")} type="number" min={0} value={rule.value ?? ""} onChange={(e) => onChange({ ...rule, value: e.target.value })} aria-label="Days" />
          <span className="text-sm text-fg-3">days</span>
        </span>
      )}
      {input === "range" && (
        <span className="flex w-full items-center gap-2 sm:flex-1">
          <input className={clsx(box, "min-w-0 flex-1")} type={type === "date" ? "date" : "number"} value={rule.value ?? ""} onChange={(e) => onChange({ ...rule, value: e.target.value })} aria-label="From" />
          <span className="text-sm text-fg-3">and</span>
          <input className={clsx(box, "min-w-0 flex-1")} type={type === "date" ? "date" : "number"} value={rule.value2 ?? ""} onChange={(e) => onChange({ ...rule, value2: e.target.value })} aria-label="To" />
        </span>
      )}
      {input === "list" && (
        field?.choices && field.choices.length > 0 ? (
          <span className="flex w-full flex-wrap gap-1 sm:flex-1">
            {field.choices.map((choice) => {
              const picked = (rule.value ?? "").split(",").map((v) => v.trim()).filter(Boolean);
              const on = picked.includes(choice);
              return (
                <button
                  key={choice}
                  type="button"
                  aria-pressed={on}
                  onClick={() => onChange({ ...rule, value: (on ? picked.filter((p) => p !== choice) : [...picked, choice]).join(", ") })}
                  className={clsx("h-7 rounded-full border px-2.5 text-xs transition-colors", on ? "border-fg bg-fg text-background" : "border-line text-fg-2 hover:border-line-strong")}
                >
                  {choice}
                </button>
              );
            })}
          </span>
        ) : (
          <input className={clsx(box, "w-full min-w-0 sm:flex-1")} value={rule.value ?? ""} onChange={(e) => onChange({ ...rule, value: e.target.value })} placeholder="Values, separated by commas" aria-label="Values" />
        )
      )}
    </div>
  );
}
