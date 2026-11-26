"use client";

// Panels on the Contacts page: one contact, adding one, custom fields, CSV import.

import { Trash2 } from "lucide-react";
import { useState } from "react";
import { newId } from "@/lib/flow-tree";
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
            <Field label="Name">
              <input
                className="field"
                value={contact.name}
                onChange={(e) => {
                  // {first_name} follows the name unless someone set it to something else (B24).
                  const oldFirst = contact.name.trim().split(/\s+/)[0] ?? "";
                  const current = contact.fields.first_name ?? "";
                  const follows = !current || current === oldFirst;
                  const name = e.target.value;
                  edit(follows ? { name, fields: { ...contact.fields, first_name: name.trim().split(/\s+/)[0] ?? "" } } : { name });
                }}
              />
            </Field>
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
