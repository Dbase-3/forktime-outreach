"use client";

import clsx from "clsx";
import { FileUp, Plus, Users } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useApp } from "@/lib/store";
import { AddContactSheet, ContactSheet } from "@/components/contacts/contact-sheets";
import { ContactsTable } from "@/components/contacts/contacts-table";
import { FieldsTab } from "@/components/contacts/fields-tab";
import { ImportWizard } from "@/components/contacts/import-wizard";
import { SourcesTab } from "@/components/contacts/sources-tab";
import { EmptyState, PageHeader } from "@/components/ui";

type Tab = "contacts" | "sources" | "fields";

export default function ContactsPage() {
  const app = useApp();
  const [tab, setTab] = useState<Tab>("contacts");
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const queries = useQueryClient();
  const refresh = () => {
    void queries.invalidateQueries({ queryKey: ["contacts", app.workspace.id] });
    void queries.invalidateQueries({ queryKey: ["contact-lists", app.workspace.id] });
    void queries.invalidateQueries({ queryKey: ["fields-filled", app.workspace.id] });
  };

  // Search (⌘K) links here with ?open=<id>.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("open");
    if (id) setOpenId(id);
  }, []);

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: "contacts", label: "Contacts", count: app.counts.contacts },
    { id: "sources", label: "Sources", count: app.sources.length },
    { id: "fields", label: "Fields", count: app.fieldDefs.length },
  ];

  return (
    <div>
      <PageHeader
        title="Contacts"
        subtitle="Everyone your agents can call, from your CRM, sheets and imports."
        actions={
          <>
            <button type="button" className="btn-secondary" onClick={() => setImporting(true)}>
              <FileUp size={15} /> <span className="hidden sm:inline">Import</span>
            </button>
            <button type="button" className="btn-primary" onClick={() => setAdding(true)}>
              <Plus size={15} /> Add
            </button>
          </>
        }
      />
      <div className="mb-4 flex gap-5 border-b border-line" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={clsx("-mb-px border-b-2 pb-2.5 text-sm font-medium transition-colors", tab === t.id ? "border-fg text-fg" : "border-transparent text-fg-3 hover:text-fg")}>
            {t.label} <span className="ml-1 font-mono text-xs text-fg-4">{t.count.toLocaleString()}</span>
          </button>
        ))}
      </div>

      {tab === "contacts" &&
        (app.counts.contacts === 0 ? (
          <EmptyState icon={<Users size={20} />} title="No contacts yet" body="Sync your CRM or import a CSV. Any columns work." action={<button type="button" className="btn-primary" onClick={() => setImporting(true)}>Import a CSV</button>} />
        ) : (
          <ContactsTable onOpen={setOpenId} />
        ))}
      {tab === "sources" && <SourcesTab onImport={() => setImporting(true)} />}
      {tab === "fields" && <FieldsTab />}

      <ContactSheet contactId={openId} onClose={() => setOpenId(null)} onChanged={refresh} />
      <AddContactSheet open={adding} onClose={() => setAdding(false)} onAdded={(id) => { refresh(); setOpenId(id); }} />
      <ImportWizard open={importing} onClose={() => setImporting(false)} onDone={refresh} />
    </div>
  );
}
