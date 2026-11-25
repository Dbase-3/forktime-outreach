"use client";

import clsx from "clsx";
import { FileUp, Plus, Search, SlidersHorizontal, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { useApp } from "@/lib/store";
import { AddContactSheet, ContactSheet, FieldsSheet, ImportSheet } from "@/components/contacts/contact-sheets";
import { Avatar, EmptyState, PageHeader } from "@/components/ui";

type Panel = "add" | "fields" | "import" | null;

export default function ContactsPage() {
  const app = useApp();
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  // Search (⌘K) links here with ?open=<id>.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("open");
    if (id) setOpenId(id);
  }, []);
  const groups = [...new Set(app.contacts.flatMap((c) => c.groups))];
  const q = query.trim().toLowerCase();
  const shown = app.contacts.filter((c) => (!group || c.groups.includes(group)) && (!q || `${c.name} ${c.phone} ${c.email ?? ""}`.toLowerCase().includes(q)));
  const visibleDefs = app.fieldDefs.filter((d) => d.key !== "first_name").slice(0, 2);

  return (
    <div>
      <PageHeader
        title="Contacts"
        subtitle={`${app.contacts.length} people`}
        actions={
          <>
            <button type="button" className="btn-secondary" onClick={() => setPanel("import")}>
              <FileUp size={16} /> <span className="hidden sm:inline">Import</span>
            </button>
            <button type="button" className="btn-primary" onClick={() => setPanel("add")}>
              <Plus size={16} /> Add
            </button>
          </>
        }
      />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-fg-4" />
          <input className="field pl-10" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, phone or email" />
        </div>
        <button type="button" className="btn-secondary" onClick={() => setPanel("fields")}>
          <SlidersHorizontal size={16} /> Fields
        </button>
      </div>
      {groups.length > 0 && (
        <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
          {[null, ...groups].map((g) => (
            <button key={g ?? "all"} type="button" onClick={() => setGroup(g)} className={clsx("shrink-0 rounded-full border px-3 py-1.5 text-sm transition", group === g ? "border-fg bg-fg text-background" : "border-line bg-surface text-fg-2 hover:bg-subtle")}>
              {g ?? "Everyone"}
            </button>
          ))}
        </div>
      )}
      {app.contacts.length === 0 ? (
        <EmptyState icon={<Users size={22} />} title="No contacts yet" body="Import a CSV or add people one by one." action={<button type="button" className="btn-primary" onClick={() => setPanel("import")}>Import a CSV</button>} />
      ) : (
        <div className="card divide-y divide-line overflow-hidden">
          {shown.length === 0 && <p className="p-4 text-sm text-fg-3">No one matches.</p>}
          {shown.map((contact) => (
            <button key={contact.id} type="button" onClick={() => setOpenId(contact.id)} className="flex w-full items-center gap-3 p-3.5 text-left transition hover:bg-subtle">
              <Avatar name={contact.name} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{contact.name}</span>
                <span className="block truncate text-xs text-fg-3">{contact.phone}</span>
              </span>
              {visibleDefs.map((def) => (
                <span key={def.key} className="hidden w-36 truncate text-sm text-fg-2 md:block">
                  <span className="block text-2xs text-fg-4">{def.label}</span>
                  {contact.fields[def.key] || "—"}
                </span>
              ))}
            </button>
          ))}
        </div>
      )}
      <ContactSheet contact={app.contacts.find((c) => c.id === openId) ?? null} onClose={() => setOpenId(null)} />
      <AddContactSheet open={panel === "add"} onClose={() => setPanel(null)} />
      <FieldsSheet open={panel === "fields"} onClose={() => setPanel(null)} />
      <ImportSheet open={panel === "import"} onClose={() => setPanel(null)} />
    </div>
  );
}
