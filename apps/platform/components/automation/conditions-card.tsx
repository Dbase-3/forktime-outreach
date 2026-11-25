"use client";

// "Only if": optional rules a contact must match to get the call.

import { Plus, X } from "lucide-react";
import { OP_LABELS, VALUELESS_OPS } from "@/lib/automation";
import type { Condition, FieldDef } from "@/lib/types";

export function ConditionsCard({ conditions, defs, onChange }: { conditions: Condition[]; defs: FieldDef[]; onChange: (next: Condition[]) => void }) {
  const set = (index: number, patch: Partial<Condition>) => onChange(conditions.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  return (
    <div className="space-y-2.5">
      {conditions.length === 0 && <p className="text-sm text-fg-3">Everyone it applies to gets the call.</p>}
      {conditions.map((condition, index) => (
        <div key={index} className="flex flex-wrap items-center gap-2 rounded-lg bg-subtle p-2.5 sm:flex-nowrap">
          {index > 0 && <span className="w-full text-xs font-medium text-fg-4 sm:w-auto">and</span>}
          <select className="field min-w-0 flex-1 py-2" value={condition.field} onChange={(e) => set(index, { field: e.target.value })} aria-label="Field">
            {defs.map((d) => (
              <option key={d.key} value={d.key}>{d.label}</option>
            ))}
          </select>
          <select className="field w-auto py-2" value={condition.op} onChange={(e) => set(index, { op: e.target.value as Condition["op"] })} aria-label="Rule">
            {Object.entries(OP_LABELS).map(([op, label]) => (
              <option key={op} value={op}>{label}</option>
            ))}
          </select>
          {!VALUELESS_OPS.includes(condition.op) && (
            <input className="field min-w-0 flex-1 py-2" value={condition.value ?? ""} onChange={(e) => set(index, { value: e.target.value })} placeholder="Value" aria-label="Value" />
          )}
          <button type="button" className="btn-icon" onClick={() => onChange(conditions.filter((_, i) => i !== index))} aria-label="Remove condition">
            <X size={16} />
          </button>
        </div>
      ))}
      <button type="button" className="btn-ghost -ml-2 h-9 px-2 text-accent hover:text-accent" onClick={() => onChange([...conditions, { field: defs[0]?.key ?? "", op: "is", value: "" }])}>
        <Plus size={16} /> Add a condition
      </button>
    </div>
  );
}
