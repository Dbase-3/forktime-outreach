"use client";

// Every field contacts can have: from a source, saved by calls, or added here.

import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { fieldUsage } from "@/lib/field-usage";
import { toFieldKey } from "@/lib/flow-tree";
import { integrationInfo } from "@/lib/integrations";
import { update, useApp } from "@/lib/store";
import type { FieldType } from "@/lib/types";
import { Confirm } from "../confirm";

const TYPES: FieldType[] = ["text", "number", "date", "yesno", "choice", "phone", "email"];
const TYPE_LABEL: Record<FieldType, string> = { text: "Text", number: "Number", date: "Date", yesno: "Yes / No", choice: "Choice", phone: "Phone", email: "Email" };

export function FieldsTab() {
  const app = useApp();
  const [label, setLabel] = useState("");
  const [type, setType] = useState<FieldType>("text");
  const key = toFieldKey(label);
  const taken = app.fieldDefs.some((d) => d.key === key);
  const sourceName = (id?: string) => {
    if (!id) return "Added here";
    if (id === "call") return "Saved by calls";
    const src = app.sources.find((s) => s.id === id);
    return src ? (src.integrationId ? integrationInfo(src.integrationId)?.name ?? src.name : src.name) : "Removed source";
  };
  const used = (k: string) => app.contacts.filter((c) => (c.fields[k] ?? "") !== "").length;
  const add = () => {
    if (!key || taken) return;
    update((s) => ({ ...s, fieldDefs: [...s.fieldDefs, { key, label: label.trim(), type }] }));
    setLabel("");
  };

  return (
    <div className="space-y-4">
      <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <input className="field sm:w-72" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="New field, e.g. Next service date" />
        <select className="field sm:w-36" value={type} onChange={(e) => setType(e.target.value as FieldType)} aria-label="Type">
          {TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
        </select>
        <button type="submit" className="btn-primary" disabled={!key || taken}><Plus size={15} /> Add field</button>
        {taken && <span className="self-center text-xs text-amber-700 dark:text-amber-400">That field already exists.</span>}
      </form>
      <div className="card overflow-hidden">
        <table className="w-full table-fixed text-sm">
          <thead className="bg-subtle/60 text-left">
            <tr>
              <th className="metric-label px-4 py-2.5 font-normal">Field</th>
              <th className="metric-label w-32 px-4 py-2.5 font-normal">Type</th>
              <th className="metric-label hidden w-40 px-4 py-2.5 font-normal md:table-cell">Comes from</th>
              <th className="metric-label hidden w-28 px-4 py-2.5 font-normal sm:table-cell">Filled in</th>
              <th className="w-14 px-4 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {app.fieldDefs.map((def) => (
              <tr key={def.key}>
                <td className="px-4 py-2.5">
                  <input className="w-full bg-transparent font-medium outline-none focus:underline" value={def.label} onChange={(e) => update((s) => ({ ...s, fieldDefs: s.fieldDefs.map((d) => (d.key === def.key ? { ...d, label: e.target.value } : d)) }))} aria-label="Field name" />
                  <div className="font-mono text-2xs text-fg-4">{def.key}</div>
                </td>
                <td className="px-4 py-2.5">
                  <TypePicker def={def} uses={fieldUsage(app, def.key)} />
                </td>
                <td className="hidden truncate px-4 py-2.5 text-fg-2 md:table-cell">{sourceName(def.source)}</td>
                <td className="hidden px-4 py-2.5 font-mono text-xs text-fg-3 sm:table-cell">{used(def.key)} / {app.contacts.length}</td>
                <td className="px-4 py-2.5 text-right">
                  <Confirm
                    title={`Remove ${def.label || def.key}?`}
                    body={`Its values on ${used(def.key)} ${used(def.key) === 1 ? "contact" : "contacts"} are kept but hidden.`}
                    action="Remove"
                    danger
                    blocked={(() => {
                      const uses = fieldUsage(app, def.key);
                      return uses.length ? <>It&apos;s in use: {uses.join("; ")}. Change those first.</> : undefined;
                    })()}
                    onConfirm={() => update((s) => ({ ...s, fieldDefs: s.fieldDefs.filter((d) => d.key !== def.key) }))}
                    trigger={<button type="button" className="btn-icon h-8 w-8 hover:text-rose-600" aria-label={`Remove ${def.label}`}><Trash2 size={14} /></button>}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Changing a used field's type asks first: rules on it may stop matching (B23). */
function TypePicker({ def, uses }: { def: { key: string; label: string; type: FieldType }; uses: string[] }) {
  const [pending, setPending] = useState<FieldType | null>(null);
  const apply = (type: FieldType) => update((s) => ({ ...s, fieldDefs: s.fieldDefs.map((d) => (d.key === def.key ? { ...d, type } : d)) }));
  return (
    <div>
      <select
        className="field h-8 py-0 text-sm"
        value={pending ?? def.type}
        onChange={(e) => {
          const type = e.target.value as FieldType;
          if (uses.length && type !== def.type) setPending(type);
          else apply(type);
        }}
        aria-label={`${def.label} type`}
      >
        {TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
      </select>
      {pending && (
        <div className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.07] p-2 text-xs">
          <p className="text-fg-2">Rules on this field may stop matching: {uses.join("; ")}.</p>
          <div className="mt-2 flex gap-2">
            <button type="button" className="btn-primary h-7 px-2.5 text-xs" onClick={() => { apply(pending); setPending(null); }}>Change to {TYPE_LABEL[pending]}</button>
            <button type="button" className="btn-ghost h-7 px-2.5 text-xs" onClick={() => setPending(null)}>Keep {TYPE_LABEL[def.type]}</button>
          </div>
        </div>
      )}
    </div>
  );
}
