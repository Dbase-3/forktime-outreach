"use client";

import clsx from "clsx";
import { BookOpen, FileUp, Globe, Search, Type } from "lucide-react";
import { useEffect, useState } from "react";
import { refreshReading } from "@/lib/actions";
import { KIND_LABEL, formatBytes, usedByLabel } from "@outreach/core/knowledge";
import { relativeTime } from "@outreach/core/format";
import { useApp } from "@/lib/store";
import type { KnowledgeDoc } from "@outreach/core/types";
import { AddKnowledgeSheet, type AddKind } from "@/components/knowledge/add-sheets";
import { DocSheet } from "@/components/knowledge/doc-sheet";
import { DocIcon, DocStatus } from "@/components/knowledge/doc-status";
import { EmptyState, PageHeader } from "@/components/ui";

type Filter = "all" | "web" | "file" | "text" | "shared";

const FILTERS: { id: Filter; label: string; test: (d: KnowledgeDoc) => boolean }[] = [
  { id: "all", label: "All", test: () => true },
  { id: "web", label: "Web", test: (d) => d.kind === "url" || d.kind === "sitemap" || d.kind === "site" },
  { id: "file", label: "Files", test: (d) => d.kind === "file" },
  { id: "text", label: "Text", test: (d) => d.kind === "text" },
  { id: "shared", label: "Every agent", test: (d) => d.availableToAll },
];

const ADD: { kind: AddKind; label: string; hint: string; icon: typeof Globe }[] = [
  { kind: "url", label: "Add a web address", hint: "A page, a sitemap or a whole site", icon: Globe },
  { kind: "files", label: "Add files", hint: "PDF, Word, text, CSV", icon: FileUp },
  { kind: "text", label: "Write text", hint: "Hours, prices, policies", icon: Type },
];

export default function KnowledgePage() {
  const app = useApp();
  // Web documents are read on the server; check back while any are still reading.
  const reading = app.knowledge.some((d) => d.status === "reading");
  useEffect(() => {
    if (!reading) return;
    const t = setInterval(() => void refreshReading(), 3000);
    return () => clearInterval(t);
  }, [reading]);
  const [adding, setAdding] = useState<AddKind | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const test = FILTERS.find((f) => f.id === filter)?.test ?? (() => true);
  const docs = app.knowledge.filter(test).filter((d) => !q || `${d.name} ${d.source ?? ""}`.toLowerCase().includes(q));
  const used = app.knowledge.reduce((sum, d) => sum + d.sizeBytes, 0);

  return (
    <div>
      <PageHeader
        title="Knowledge"
        subtitle="What your agents answer from. Make a document available to every agent, or attach it to the ones that need it."
        actions={<span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-line bg-surface px-3 font-mono text-xs text-fg-3"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />{formatBytes(used)} of 50 MB</span>}
      />

      <div className="mb-5 grid gap-2 sm:grid-cols-3">
        {ADD.map(({ kind, label, hint, icon: Icon }) => (
          <button key={kind} type="button" onClick={() => setAdding(kind)} className="flex items-center gap-3 rounded-xl border border-line bg-surface p-3 text-left transition-colors hover:border-line-strong hover:bg-subtle">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line bg-subtle text-fg-2"><Icon size={16} /></span>
            <span className="min-w-0">
              <span className="block text-sm font-medium">{label}</span>
              <span className="block truncate text-xs text-fg-3">{hint}</span>
            </span>
          </button>
        ))}
      </div>

      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" onClick={() => setFilter(f.id)} className={clsx("flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors", filter === f.id ? "border-fg bg-fg text-background" : "border-line bg-surface text-fg-2 hover:border-line-strong")}>
              {f.label}
              <span className={clsx("font-mono text-xs", filter === f.id ? "text-background/70" : "text-fg-4")}>{app.knowledge.filter(f.test).length}</span>
            </button>
          ))}
        </div>
        <div className="relative sm:w-64">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-4" />
          <input className="field pl-9" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search knowledge" />
        </div>
      </div>

      {app.knowledge.length === 0 ? (
        <EmptyState icon={<BookOpen size={20} />} title="No knowledge yet" body="Add your website, a price list or your policies, and agents answer from them." action={<button type="button" className="btn-primary" onClick={() => setAdding("url")}>Add a web address</button>} />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full table-fixed text-sm">
            <thead className="hidden border-b border-line bg-subtle/60 text-left sm:table-header-group">
              <tr>
                <th className="metric-label px-4 py-2.5 font-normal">Name</th>
                <th className="metric-label w-32 px-4 py-2.5 font-normal">Used by</th>
                <th className="metric-label hidden w-24 px-4 py-2.5 font-normal md:table-cell">Size</th>
                <th className="metric-label hidden w-28 px-4 py-2.5 font-normal lg:table-cell">Updated</th>
                <th className="metric-label w-36 px-4 py-2.5 text-right font-normal sm:w-44">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {docs.map((doc) => (
                <tr key={doc.id} onClick={() => setOpenId(doc.id)} className="cursor-pointer transition-colors hover:bg-subtle">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <DocIcon doc={doc} />
                      <div className="min-w-0">
                        <div className="truncate font-medium">{doc.name}</div>
                        <div className="truncate text-xs text-fg-3">{doc.source && doc.source !== doc.name ? doc.source : KIND_LABEL[doc.kind]}</div>
                      </div>
                    </div>
                  </td>
                  <td className="hidden whitespace-nowrap px-4 py-3 text-fg-2 sm:table-cell">{usedByLabel(doc, app.flows)}</td>
                  <td className="hidden whitespace-nowrap px-4 py-3 font-mono text-xs text-fg-3 md:table-cell">{doc.sizeBytes ? formatBytes(doc.sizeBytes) : "—"}</td>
                  <td className="hidden whitespace-nowrap px-4 py-3 text-fg-3 lg:table-cell">{relativeTime(doc.updatedAt)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right"><DocStatus doc={doc} /></td>
                </tr>
              ))}
              {docs.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-fg-3">Nothing matches.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <AddKnowledgeSheet kind={adding} onClose={() => setAdding(null)} />
      <DocSheet docId={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}
