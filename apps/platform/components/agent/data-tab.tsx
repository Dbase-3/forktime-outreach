"use client";

// What the agent collects on every call, and how we judge whether it worked.
// The fields from Ask steps appear on their own; extra ones are things the
// agent listens for without asking. Each is required, or has a fallback.

import clsx from "clsx";
import { Plus, Trash2 } from "lucide-react";
import { dataSchema, structuredResult } from "@/lib/agent-data";
import { newId, toFieldKey } from "@/lib/flow-tree";
import type { DataField, FieldType, Flow, SuccessCheck } from "@/lib/types";
import { Toggle } from "../ui";

const TYPES: { value: FieldType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "yesno", label: "Yes / No" },
  { value: "choice", label: "Choice" },
  { value: "phone", label: "Phone" },
  { value: "email", label: "Email" },
];

export function DataTab({ flow, onEdit }: { flow: Flow; onEdit: (fn: (f: Flow) => Flow) => void }) {
  const schema = dataSchema(flow);
  const fromSteps = schema.filter((f) => f.from === "step");
  const setField = (key: string, patch: Partial<DataField>) => onEdit((f) => ({ ...f, dataFields: f.dataFields.map((d) => (d.key === key ? { ...d, ...patch } : d)) }));
  const addField = () => {
    const n = flow.dataFields.length + 1;
    onEdit((f) => ({ ...f, dataFields: [...f.dataFields, { key: `field_${n}`, label: "", type: "text", description: "", required: false }] }));
  };
  const example = structuredResult(schema, {});

  return (
    <div className="space-y-6 p-4">
      <section>
        <Head title="Asked in the workflow" hint="Each Ask step saves its answer here." />
        {fromSteps.length === 0 ? (
          <p className="text-sm text-fg-3">No Ask steps yet.</p>
        ) : (
          <div className="divide-y divide-line rounded-lg border border-line">
            {fromSteps.map((f) => (
              <div key={f.key} className="flex items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-xs">{f.key}</div>
                  <div className="truncate text-xs text-fg-3">{f.description}</div>
                </div>
                <span className="font-mono text-2xs text-fg-4">{f.type}</span>
                <RequiredSwitch value={f.required} onChange={(v) => onEdit((x) => ({ ...x, askRequired: { ...x.askRequired, [f.key]: v } }))} />
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <Head title="Listened for" hint="Picked up from the conversation without a question, e.g. a callback time or what they're interested in." />
        <div className="space-y-2">
          {flow.dataFields.map((field) => (
            <div key={field.key} className="rounded-lg border border-line p-3">
              <div className="flex items-center gap-2">
                <input
                  className="field h-8 min-w-0 flex-1 py-0"
                  value={field.label}
                  placeholder="Name, e.g. Callback time"
                  onChange={(e) => {
                    const label = e.target.value;
                    const key = toFieldKey(label) || field.key;
                    onEdit((f) => ({ ...f, dataFields: f.dataFields.map((d) => (d.key === field.key ? { ...d, label, key: f.dataFields.some((o) => o !== d && o.key === key) ? d.key : key } : d)) }));
                  }}
                />
                <select className="field h-8 w-28 py-0 text-sm" value={field.type} onChange={(e) => setField(field.key, { type: e.target.value as FieldType })} aria-label="Type">
                  {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
                <button type="button" className="btn-icon h-8 w-8 hover:text-rose-600" onClick={() => onEdit((f) => ({ ...f, dataFields: f.dataFields.filter((d) => d.key !== field.key) }))} aria-label="Remove field"><Trash2 size={14} /></button>
              </div>
              <input className="field mt-2 h-8 py-0 text-sm" value={field.description} onChange={(e) => setField(field.key, { description: e.target.value })} placeholder="What to listen for, in plain words" />
              {field.type === "choice" && (
                <input className="field mt-2 h-8 py-0 text-sm" value={(field.choices ?? []).join(", ")} onChange={(e) => setField(field.key, { choices: e.target.value.split(",").map((c) => c.trim()).filter(Boolean) })} placeholder="Choices, separated by commas" />
              )}
              <div className="mt-2 flex items-center gap-3">
                <RequiredSwitch value={field.required} onChange={(v) => setField(field.key, { required: v })} />
                {!field.required && (
                  <input className="field h-8 min-w-0 flex-1 py-0 text-sm" value={field.fallback ?? ""} onChange={(e) => setField(field.key, { fallback: e.target.value })} placeholder="If it doesn't come up, use…" aria-label="Fallback value" />
                )}
                <span className="ml-auto font-mono text-2xs text-fg-4">{field.key}</span>
              </div>
            </div>
          ))}
          <AddRow label="Add a field" onClick={addField} />
        </div>
      </section>

      <Checks checks={flow.checks} onChange={(checks) => onEdit((f) => ({ ...f, checks }))} />

      <section>
        <Head title="Each call hands over" hint="Sent to your CRM, webhook or sheet by the campaign that made the call." />
        <pre className="overflow-x-auto rounded-lg border border-line bg-subtle p-3 font-mono text-xs leading-relaxed text-fg-2">
          {JSON.stringify({ outcome: "…", ...Object.fromEntries(Object.entries(example.data).map(([k]) => [k, schema.find((s) => s.key === k)?.type === "yesno" ? true : "…"])) }, null, 2)}
        </pre>
      </section>
    </div>
  );
}

function Checks({ checks, onChange }: { checks: SuccessCheck[]; onChange: (c: SuccessCheck[]) => void }) {
  const set = (id: string, patch: Partial<SuccessCheck>) => onChange(checks.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  return (
    <section>
      <Head title="Success checks" hint="Each call is judged against these after it ends: passed, failed or couldn't tell." />
      <div className="space-y-2">
        {checks.map((check) => (
          <div key={check.id} className="flex items-start gap-2 rounded-lg border border-line p-3">
            <div className="min-w-0 flex-1 space-y-2">
              <input className="field h-8 py-0" value={check.label} onChange={(e) => set(check.id, { label: e.target.value })} placeholder="e.g. Booked a service" />
              <input className="field h-8 py-0 text-sm" value={check.description} onChange={(e) => set(check.id, { description: e.target.value })} placeholder="It passed when…" />
            </div>
            <button type="button" className="btn-icon h-8 w-8 hover:text-rose-600" onClick={() => onChange(checks.filter((c) => c.id !== check.id))} aria-label="Remove check"><Trash2 size={14} /></button>
          </div>
        ))}
        <AddRow label="Add a check" onClick={() => onChange([...checks, { id: newId("chk"), label: "", description: "" }])} />
      </div>
    </section>
  );
}

function RequiredSwitch({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex shrink-0 items-center gap-2 text-xs text-fg-3">
      <span className={clsx(value && "text-fg-2")}>Required</span>
      <Toggle checked={value} onChange={onChange} label="Required" />
    </label>
  );
}

function Head({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="mb-2">
      <h3 className="text-sm font-medium">{title}</h3>
      <p className="text-xs text-fg-3">{hint}</p>
    </div>
  );
}

function AddRow({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm text-fg-3 transition-colors hover:bg-muted hover:text-fg">
      <Plus size={14} /> {label}
    </button>
  );
}
