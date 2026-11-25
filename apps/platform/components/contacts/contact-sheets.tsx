"use client";

// Panels on the Contacts page: one contact, adding one, custom fields, CSV import.

import { FileUp, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { importContacts, type CsvImport } from "@/lib/csv";
import { newId, toFieldKey } from "@/lib/flow-tree";
import { humanize, relativeTime } from "@/lib/format";
import { nowIso, update, useApp } from "@/lib/store";
import type { Contact, FieldDef, FieldType } from "@/lib/types";
import { outcomeTone } from "../call-sheet";
import { Badge, Field, Sheet, useLastPresent } from "../ui";

const INPUT_TYPE: Record<FieldType, string> = { text: "text", number: "number", date: "date", yesno: "text", choice: "text", phone: "tel", email: "email" };

function FieldInputs({ defs, values, onChange }: { defs: FieldDef[]; values: Record<string, string>; onChange: (key: string, value: string) => void }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {defs.map((def) => (
        <Field key={def.key} label={def.label}>
          <input className="field" type={INPUT_TYPE[def.type]} value={values[def.key] ?? ""} onChange={(e) => onChange(def.key, e.target.value)} />
        </Field>
      ))}
    </div>
  );
}

export function ContactSheet({ contact: current, onClose }: { contact: Contact | null; onClose: () => void }) {
  const contact = useLastPresent(current);
  const app = useApp();
  const calls = contact ? app.calls.filter((c) => c.contactId === contact.id).sort((a, b) => b.startedAt.localeCompare(a.startedAt)) : [];
  const edit = (patch: Partial<Contact>) => contact && update((s) => ({ ...s, contacts: s.contacts.map((c) => (c.id === contact.id ? { ...c, ...patch } : c)) }));
  const remove = () => {
    if (!contact) return;
    update((s) => ({ ...s, contacts: s.contacts.filter((c) => c.id !== contact.id) }));
    onClose();
  };
  return (
    <Sheet
      open={current !== null}
      onClose={onClose}
      title={contact?.name ?? ""}
      wide
      footer={
        <div className="flex">
          <button type="button" className="btn-ghost text-rose-600 dark:text-rose-400 hover:bg-rose-500/10" onClick={remove}>
            <Trash2 size={16} /> Delete
          </button>
          <button type="button" className="btn-primary ml-auto" onClick={onClose}>Done</button>
        </div>
      }
    >
      {contact && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name"><input className="field" value={contact.name} onChange={(e) => edit({ name: e.target.value })} /></Field>
            <Field label="Phone"><input className="field" type="tel" value={contact.phone} onChange={(e) => edit({ phone: e.target.value })} /></Field>
            <Field label="Email"><input className="field" type="email" value={contact.email ?? ""} onChange={(e) => edit({ email: e.target.value })} /></Field>
            <Field label="Groups" hint="Separate with commas.">
              <input className="field" value={contact.groups.join(", ")} onChange={(e) => edit({ groups: e.target.value.split(",").map((g) => g.trim()).filter(Boolean) })} />
            </Field>
          </div>
          <div>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-fg-4">Fields</h3>
            <FieldInputs defs={app.fieldDefs} values={contact.fields} onChange={(key, value) => edit({ fields: { ...contact.fields, [key]: value } })} />
          </div>
          <div>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-fg-4">Calls</h3>
            {calls.length === 0 && <p className="text-sm text-fg-3">No calls yet.</p>}
            <ul className="space-y-2">
              {calls.map((call) => (
                <li key={call.id} className="rounded-lg bg-subtle p-3">
                  <div className="flex items-center justify-between gap-2">
                    <Badge tone={outcomeTone(call.outcome)}>{humanize(call.outcome)}</Badge>
                    <span className="text-xs text-fg-4">{relativeTime(call.startedAt)}</span>
                  </div>
                  <p className="mt-1.5 text-sm text-fg-2">{call.summary}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </Sheet>
  );
}

export function AddContactSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { fieldDefs } = useApp();
  const [draft, setDraft] = useState({ name: "", phone: "", email: "", group: "", fields: {} as Record<string, string> });
  const save = () => {
    if (!draft.name.trim() || !draft.phone.trim()) return;
    const contact: Contact = {
      id: newId("c"),
      name: draft.name.trim(),
      phone: draft.phone.trim(),
      email: draft.email.trim() || undefined,
      groups: draft.group.trim() ? [draft.group.trim()] : [],
      fields: { first_name: draft.name.trim().split(" ")[0], ...draft.fields },
      createdAt: nowIso(),
    };
    update((s) => ({ ...s, contacts: [contact, ...s.contacts] }));
    setDraft({ name: "", phone: "", email: "", group: "", fields: {} });
    onClose();
  };
  return (
    <Sheet open={open} onClose={onClose} title="Add a contact" wide footer={<button type="button" className="btn-primary w-full" disabled={!draft.name.trim() || !draft.phone.trim()} onClick={save}>Add contact</button>}>
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name"><input className="field" autoFocus value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
          <Field label="Phone"><input className="field" type="tel" value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} placeholder="+61 4…" /></Field>
          <Field label="Email · optional"><input className="field" type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} /></Field>
          <Field label="Group · optional"><input className="field" value={draft.group} onChange={(e) => setDraft({ ...draft, group: e.target.value })} /></Field>
        </div>
        <FieldInputs defs={fieldDefs.filter((d) => d.key !== "first_name")} values={draft.fields} onChange={(key, value) => setDraft({ ...draft, fields: { ...draft.fields, [key]: value } })} />
      </div>
    </Sheet>
  );
}

const TYPES: { value: FieldType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "yesno", label: "Yes / No" },
];

export function FieldsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { fieldDefs } = useApp();
  const [label, setLabel] = useState("");
  const [type, setType] = useState<FieldType>("text");
  const key = toFieldKey(label);
  const add = () => {
    if (!key || fieldDefs.some((d) => d.key === key)) return;
    update((s) => ({ ...s, fieldDefs: [...s.fieldDefs, { key, label: label.trim(), type }] }));
    setLabel("");
  };
  return (
    <Sheet open={open} onClose={onClose} title="Contact fields">
      <p className="mb-4 text-sm text-fg-3">Anything you know about a contact. Flows can read them out, and automations can trigger on them.</p>
      <ul className="mb-5 divide-y divide-line rounded-xl border border-line">
        {fieldDefs.map((def) => (
          <li key={def.key} className="flex items-center gap-3 px-4 py-2.5">
            <span className="flex-1 text-sm font-medium">{def.label}</span>
            <span className="text-xs text-fg-4">{TYPES.find((t) => t.value === def.type)?.label ?? def.type}</span>
            <button type="button" className="btn-icon h-8 w-8" aria-label={`Remove ${def.label}`} onClick={() => update((s) => ({ ...s, fieldDefs: s.fieldDefs.filter((d) => d.key !== def.key) }))}>
              <Trash2 size={15} />
            </button>
          </li>
        ))}
      </ul>
      <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <input className="field flex-1" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Next service date" />
        <select className="field sm:w-32" value={type} onChange={(e) => setType(e.target.value as FieldType)}>
          {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <button type="submit" className="btn-primary" disabled={!key || fieldDefs.some((d) => d.key === key)}>
          <Plus size={16} /> Add
        </button>
      </form>
    </Sheet>
  );
}

export function ImportSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [result, setResult] = useState<CsvImport | null>(null);
  const [group, setGroup] = useState("Imported");
  const read = async (file: File | undefined) => {
    if (!file) return;
    setResult(importContacts(await file.text()));
  };
  const save = () => {
    if (!result) return;
    const now = nowIso();
    update((s) => ({
      ...s,
      fieldDefs: [...s.fieldDefs, ...result.newFields.filter((f) => !s.fieldDefs.some((d) => d.key === f.key)).map((f) => ({ ...f, type: guessType(f.key, result) }))],
      contacts: [...result.contacts.map((c) => ({ ...c, id: newId("c"), groups: group.trim() ? [group.trim()] : [], createdAt: now })), ...s.contacts],
    }));
    setResult(null);
    onClose();
  };
  return (
    <Sheet open={open} onClose={onClose} title="Import contacts" footer={result && <button type="button" className="btn-primary w-full" disabled={result.contacts.length === 0} onClick={save}>Import {result.contacts.length} contacts</button>}>
      <label className="flex cursor-pointer flex-col items-center rounded-xl border-2 border-dashed border-line px-6 py-10 text-center transition hover:border-accent/50 hover:bg-accent/5">
        <FileUp size={24} className="text-accent" />
        <span className="mt-3 text-sm font-semibold">Choose a CSV file</span>
        <span className="mt-1 text-xs text-fg-3">Needs a phone column. Every other column becomes a field.</span>
        <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => read(e.target.files?.[0])} />
      </label>
      {result && (
        <div className="mt-5 space-y-4">
          <p className="text-sm">
            Found <span className="font-semibold">{result.contacts.length}</span> contacts
            {result.skipped > 0 && <> · {result.skipped} rows skipped (no phone)</>}
            {result.newFields.length > 0 && <> · new fields: {result.newFields.map((f) => f.label).join(", ")}</>}
          </p>
          <Field label="Put them in group"><input className="field" value={group} onChange={(e) => setGroup(e.target.value)} /></Field>
        </div>
      )}
    </Sheet>
  );
}

/** A column whose values all look like dates becomes a date field (so automations can use it). */
function guessType(key: string, result: CsvImport): FieldType {
  const values = result.contacts.map((c) => c.fields[key]).filter(Boolean);
  if (values.length > 0 && values.every((v) => /^\d{4}-\d{2}-\d{2}/.test(v))) return "date";
  if (values.length > 0 && values.every((v) => !Number.isNaN(Number(v)))) return "number";
  return "text";
}
