"use client";

// Panels on the Contacts page: one contact, adding one, custom fields, CSV import.

import { Trash2 } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { humanize, relativeTime } from "@outreach/core/format";
import { ApiError, ws } from "@/lib/api";
import { createContact, deleteContacts, getContact, saveContact, type ServerContact } from "@/lib/contacts-api";
import { useApp } from "@/lib/store";
import type { Call, Contact, FieldDef, FieldType } from "@outreach/core/types";
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

type Editable = Pick<Contact, "name" | "phone" | "email" | "groups" | "fields">;

/** One contact, loaded from the server. Edits save in the background (with the version they were made on). */
export function ContactSheet({ contactId, onClose, onChanged }: { contactId: string | null; onClose: () => void; onChanged?: () => void }) {
  const openId = useLastPresent(contactId);
  const app = useApp();
  const queries = useQueryClient();
  const loaded = useQuery({ queryKey: ["contact", app.workspace.id, openId], queryFn: () => getContact(openId!), enabled: Boolean(openId) });
  const calls = useQuery({ queryKey: ["contact-calls", app.workspace.id, openId], queryFn: () => ws<{ rows: Call[] }>("/calls/query", { body: { contactId: openId, pageSize: 20 } }), enabled: Boolean(openId) });
  const [draft, setDraft] = useState<(Editable & { id: string; version: number }) | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const pending = useRef<Partial<Editable>>({});
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const version = useRef(0);

  // A newly opened contact replaces the draft; refetches of the same one don't overwrite typing.
  useEffect(() => {
    const c = loaded.data;
    if (c && draft?.id !== c.id) {
      version.current = c.version;
      setDraft({ id: c.id, version: c.version, name: c.name, phone: c.phone, email: c.email, groups: c.groups, fields: c.fields });
      setProblem(null);
      setConfirming(false);
    }
  }, [loaded.data, draft?.id]);

  const send = async (id: string) => {
    const patch = pending.current;
    pending.current = {};
    if (!Object.keys(patch).length) return;
    try {
      const out = await saveContact(id, version.current, patch);
      version.current = out.version;
      setProblem(null);
      onChanged?.();
    } catch (err) {
      if (err instanceof ApiError && err.code === "stale") {
        const current = (err.details as { current?: ServerContact } | undefined)?.current;
        if (current) {
          version.current = current.version;
          setDraft({ id: current.id, version: current.version, name: current.name, phone: current.phone, email: current.email, groups: current.groups, fields: current.fields });
        }
        setProblem("Someone else changed this contact just now, so it's been reloaded with their version.");
      } else setProblem(err instanceof Error ? err.message : "Couldn't save.");
    }
  };
  const edit = (patch: Partial<Editable>) => {
    if (!draft) return;
    setDraft({ ...draft, ...patch });
    pending.current = { ...pending.current, ...patch };
    clearTimeout(timer.current);
    const id = draft.id;
    timer.current = setTimeout(() => void send(id), 600);
  };
  const close = () => {
    clearTimeout(timer.current);
    if (draft) void send(draft.id).then(() => queries.invalidateQueries({ queryKey: ["contact", app.workspace.id, draft.id] }));
    onClose();
  };
  const remove = async () => {
    if (!draft) return;
    clearTimeout(timer.current);
    pending.current = {};
    try {
      await deleteContacts({ ids: [draft.id] });
      onChanged?.();
      onClose();
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "Couldn't delete.");
    }
  };
  const contact = draft && draft.id === openId ? draft : null;
  const callRows = (calls.data?.rows ?? []).slice().sort((a, b) => b.startedAt.localeCompare(a.startedAt));

  return (
    <Sheet
      open={contactId !== null}
      onClose={close}
      title={contact?.name ?? (loaded.isError ? "Contact" : "")}
      wide
      footer={
        <div className="flex items-center gap-2">
          {confirming ? (
            <>
              <span className="text-sm text-rose-700 dark:text-rose-400">Delete this contact?</span>
              <button type="button" className="btn h-9 bg-rose-600 text-white hover:bg-rose-700" onClick={() => void remove()}>Delete</button>
              <button type="button" className="btn-ghost" onClick={() => setConfirming(false)}>Cancel</button>
            </>
          ) : (
            <button type="button" className="btn-ghost text-rose-600 dark:text-rose-400 hover:bg-rose-500/10" disabled={!contact} onClick={() => setConfirming(true)}>
              <Trash2 size={16} /> Delete
            </button>
          )}
          <button type="button" className="btn-primary ml-auto" onClick={close}>Done</button>
        </div>
      }
    >
      {loaded.isError && <p className="text-sm text-fg-2">{loaded.error instanceof Error ? loaded.error.message : "Couldn't load this contact."}</p>}
      {!contact && !loaded.isError && <div className="space-y-3">{[0, 1, 2].map((i) => <span key={i} className="skeleton block h-9 rounded-lg" />)}</div>}
      {contact && (
        <div className="space-y-6">
          {problem && <p className="rounded-lg border border-line bg-subtle px-3 py-2 text-sm text-fg-2">{problem}</p>}
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
            <Field label="Lists" hint="Separate with commas.">
              <input className="field" value={contact.groups.join(", ")} onChange={(e) => edit({ groups: e.target.value.split(",").map((g) => g.trim()).filter(Boolean) })} />
            </Field>
          </div>
          <div>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-fg-4">Fields</h3>
            <FieldInputs defs={app.fieldDefs} values={contact.fields} onChange={(key, value) => edit({ fields: { ...contact.fields, [key]: value } })} />
          </div>
          <div>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-fg-4">Calls</h3>
            {calls.isLoading && <span className="skeleton block h-14 rounded-lg" />}
            {!calls.isLoading && callRows.length === 0 && <p className="text-sm text-fg-3">No calls yet.</p>}
            <ul className="space-y-2">
              {callRows.map((call) => (
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

export function AddContactSheet({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded?: (id: string) => void }) {
  const { fieldDefs } = useApp();
  const [draft, setDraft] = useState({ name: "", phone: "", email: "", group: "", fields: {} as Record<string, string> });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ message: string; contactId?: string } | null>(null);
  const save = async () => {
    if (!draft.name.trim() || !draft.phone.trim()) return;
    setBusy(true);
    setProblem(null);
    try {
      const c = await createContact({
        name: draft.name.trim(),
        phone: draft.phone.trim(),
        email: draft.email.trim() || undefined,
        groups: draft.group.trim() ? [draft.group.trim()] : [],
        fields: { first_name: draft.name.trim().split(" ")[0], ...draft.fields },
      });
      setDraft({ name: "", phone: "", email: "", group: "", fields: {} });
      onAdded?.(c.id);
      onClose();
    } catch (err) {
      setProblem({ message: err instanceof Error ? err.message : "Couldn't add the contact.", contactId: err instanceof ApiError ? (err.details as { contactId?: string } | undefined)?.contactId : undefined });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title="Add a contact" wide footer={<button type="button" className="btn-primary w-full" disabled={busy || !draft.name.trim() || !draft.phone.trim()} onClick={() => void save()}>{busy ? "Adding…" : "Add contact"}</button>}>
      <div className="space-y-4">
        {problem && (
          <p className="rounded-lg border border-line bg-subtle px-3 py-2 text-sm text-fg-2">
            {problem.message}
            {problem.contactId && onAdded && <button type="button" className="ml-2 text-accent hover:underline" onClick={() => { onAdded(problem.contactId!); onClose(); }}>Open them</button>}
          </p>
        )}
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
