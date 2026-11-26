"use client";

// One document: where it came from, who uses it, its text.

import { RefreshCw, Trash2 } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { knowledgeContent, refreshReading, saveKnowledgeText } from "@/lib/actions";
import { KIND_LABEL, attachedTo, deleteBlockedReason, formatBytes } from "@outreach/core/knowledge";
import { relativeTime } from "@outreach/core/format";
import { useApp } from "@/lib/store";
import type { KnowledgeDoc } from "@outreach/core/types";
import { Sheet, Toggle, useLastPresent } from "../ui";
import { refreshUrl, removeDoc, setDoc, toggleAttached } from "./actions";
import { DocStatus } from "./doc-status";

export function DocSheet({ docId, onClose }: { docId: string | null; onClose: () => void }) {
  const app = useApp();
  const doc = useLastPresent(app.knowledge.find((d) => d.id === docId) ?? null);
  const blocked = doc ? deleteBlockedReason(doc, app.flows) : null;
  const web = doc && (doc.kind === "url" || doc.kind === "sitemap" || doc.kind === "site");
  const users = doc ? attachedTo(doc, app.flows).map((f) => f.id) : [];
  // The text is loaded when the document is opened (the list doesn't carry it).
  const full = useQuery({ queryKey: ["knowledge", docId, doc?.updatedAt], queryFn: () => knowledgeContent(docId as string), enabled: Boolean(docId) && doc?.status !== "reading" });
  const queries = useQueryClient();
  const [text, setText] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const version = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    if (full.data) {
      setText(full.data.content);
      version.current = full.data.version;
    }
  }, [full.data]);
  useEffect(() => {
    setText(null);
    setProblem(null);
  }, [docId]);
  // While it's being read on the server, check back every few seconds.
  useEffect(() => {
    if (doc?.status !== "reading") return;
    const t = setInterval(() => void refreshReading(), 3000);
    return () => clearInterval(t);
  }, [doc?.status]);
  const editText = (value: string) => {
    setText(value);
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      if (!docId || version.current === null) return;
      try {
        const saved = await saveKnowledgeText(docId, version.current, value);
        version.current = saved.version;
        queries.setQueryData(["knowledge", docId, saved.updatedAt], saved);
        setProblem(null);
      } catch (err) {
        setProblem(err instanceof Error ? err.message : "Couldn't save the text.");
      }
    }, 700);
  };
  const content = text ?? "";

  return (
    <Sheet
      open={docId !== null && Boolean(app.knowledge.find((d) => d.id === docId))}
      onClose={onClose}
      title={doc?.name ?? ""}
      size="lg"
      footer={
        doc && (
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="btn-ghost text-rose-600 hover:bg-rose-500/10 disabled:opacity-40"
              disabled={Boolean(blocked)}
              title={blocked ?? undefined}
              onClick={async () => {
                try {
                  await removeDoc(doc.id);
                  onClose();
                } catch (err) {
                  setProblem(err instanceof Error ? err.message : "Couldn't delete it.");
                }
              }}
            >
              <Trash2 size={15} /> Delete
            </button>
            {blocked && <span className="min-w-0 flex-1 text-xs text-fg-3">{blocked}</span>}
          </div>
        )
      }
    >
      {doc && (
        <div className="space-y-6">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <Info label="Type">{KIND_LABEL[doc.kind]}</Info>
            <Info label="Status"><DocStatus doc={doc} /></Info>
            <Info label="Size">{doc.sizeBytes ? formatBytes(doc.sizeBytes) : "—"}{doc.pages ? ` · ${doc.pages} ${doc.pages === 1 ? "page" : "pages"}` : ""}</Info>
            <Info label="Updated">{relativeTime(doc.updatedAt)}</Info>
            {doc.source && (
              <div className="col-span-2">
                <dt className="metric-label mb-1">Source</dt>
                <dd className="truncate">{web ? <a href={doc.source} target="_blank" rel="noreferrer" className="text-accent hover:underline">{doc.source}</a> : doc.source}</dd>
              </div>
            )}
          </dl>
          {doc.status === "failed" && doc.error && <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-800 dark:text-rose-300">{doc.error}</p>}
          {doc.status === "waiting" && <p className="rounded-lg border border-line bg-subtle px-3 py-2 text-sm text-fg-2">This file was added before files could be read. Remove it and add it again so agents can use it.</p>}

          {web && (
            <div className="divide-y divide-line rounded-lg border border-line">
              <Row title="Keep it up to date" hint="Read it again every day.">
                <Toggle checked={Boolean(doc.autoRefresh)} onChange={(v) => setDoc(doc.id, { autoRefresh: v })} label="Keep it up to date" />
              </Row>
              <Row title="Read it again now" hint={doc.status === "reading" ? "Reading…" : `Last read ${relativeTime(doc.updatedAt)}`}>
                <button type="button" className="btn-secondary h-8" disabled={doc.status === "reading"} onClick={() => void refreshUrl(doc.id)}>
                  <RefreshCw size={14} className={doc.status === "reading" ? "animate-spin" : undefined} /> Refresh
                </button>
              </Row>
            </div>
          )}

          <section>
            <h3 className="metric-label mb-2">Who uses it</h3>
            <div className="divide-y divide-line rounded-lg border border-line">
              <Row title="Every agent" hint="New agents get it too.">
                <Toggle checked={doc.availableToAll} onChange={(v) => setDoc(doc.id, { availableToAll: v })} label="Available to every agent" />
              </Row>
              {!doc.availableToAll &&
                app.flows.map((flow) => (
                  <Row key={flow.id} title={flow.name} hint={flow.status === "live" ? "Live" : "Draft"}>
                    <Toggle checked={users.includes(flow.id)} onChange={(v) => toggleAttached(doc.id, flow.id, v)} label={`Use in ${flow.name}`} />
                  </Row>
                ))}
            </div>
          </section>

          <section>
            <h3 className="metric-label mb-2">{doc.kind === "text" ? "Text" : "What agents read"}</h3>
            {problem && <p className="mb-2 text-sm text-rose-700 dark:text-rose-400">{problem}</p>}
            {full.isLoading && text === null ? (
              <div className="space-y-2"><span className="skeleton block h-3 w-full rounded" /><span className="skeleton block h-3 w-5/6 rounded" /><span className="skeleton block h-3 w-2/3 rounded" /></div>
            ) : doc.kind === "text" ? (
              <textarea className="field min-h-64 font-mono text-xs leading-relaxed" value={content} onChange={(e) => editText(e.target.value)} />
            ) : content ? (
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-subtle p-3 font-mono text-xs leading-relaxed text-fg-2">{content}</pre>
            ) : (
              <p className="text-sm text-fg-3">Nothing read yet.</p>
            )}
          </section>
        </div>
      )}
    </Sheet>
  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="metric-label mb-1">{label}</dt>
      <dd className="truncate">{children}</dd>
    </div>
  );
}

function Row({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-3 py-2.5">
      <div className="min-w-0">
        <div className="truncate text-sm">{title}</div>
        {hint && <div className="truncate text-xs text-fg-3">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

export type { KnowledgeDoc };
