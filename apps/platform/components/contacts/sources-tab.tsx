"use client";

// Where contacts come from: CSV imports and CRMs / sheets kept in sync.

import clsx from "clsx";
import { FileSpreadsheet, Plug, RefreshCw, Trash2, Upload } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CRMS } from "@outreach/core/calendar";
import { toFieldKey } from "@outreach/core/flow-tree";
import { integrationInfo } from "@outreach/core/integrations";
import { relativeTime } from "@outreach/core/format";
import { ws } from "@/lib/api";
import { patchState, useApp } from "@/lib/store";
import type { DataSource, FieldDef, FieldType } from "@outreach/core/types";
import { IntegrationLogo } from "../integrations";
import { Badge, Field, Sheet } from "../ui";

/** Properties offered when mapping a CRM: the common ones, so the mapping can be tried before a live connection. */
const CRM_PROPERTIES: { name: string; type: FieldType; target?: "name" | "phone" | "email" }[] = [
  { name: "First name", type: "text", target: "name" },
  { name: "Last name", type: "text" },
  { name: "Phone number", type: "phone", target: "phone" },
  { name: "Email", type: "email", target: "email" },
  { name: "Lifecycle stage", type: "choice" },
  { name: "Lead status", type: "choice" },
  { name: "Last purchase date", type: "date" },
  { name: "Deal amount", type: "number" },
  { name: "City", type: "text" },
  { name: "Contact owner", type: "text" },
  { name: "Next appointment", type: "date" },
  { name: "Opted out of calls", type: "yesno" },
];

/** Tools that really sync (name, phone, email); the rest only save their setup for now. */
const isLive = (id: string | undefined) => (CRMS as readonly string[]).includes(id ?? "");

const EVERY = { "15m": "Every 15 minutes", "1h": "Every hour", "1d": "Every day" };

/**
 * A live sync runs in the background: keep checking the sources until it's
 * done, then call `onSynced` so the Contacts tab shows what it brought in
 * without a reload. Used by the Contacts page (not the Sources tab), so it keeps
 * watching whichever tab is open.
 */
export function useSyncWatch(onSynced: () => void) {
  const app = useApp();
  const syncing = app.sources.some((s) => s.kind === "sync" && s.status === "syncing" && isLive(s.integrationId));
  const done = useRef(onSynced);
  done.current = onSynced;
  const wasSyncing = useRef(syncing);
  useEffect(() => {
    if (wasSyncing.current && !syncing) done.current();
    wasSyncing.current = syncing;
  }, [syncing]);
  useEffect(() => {
    if (!syncing) return;
    const t = setInterval(() => {
      ws<DataSource[]>("/sources")
        .then((list) => patchState((s) => ({ ...s, sources: list })))
        .catch(() => undefined);
    }, 2500);
    return () => clearInterval(t);
  }, [syncing]);
}

/** `onSynced` runs when a sync came back already finished (a small CRM can be done before the reply). */
export function SourcesTab({ onImport, onSynced }: { onImport: () => void; onSynced?: () => void }) {
  const app = useApp();
  const [syncing, setSyncing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const run = async (fn: () => Promise<void>) => {
    setProblem(null);
    try {
      await fn();
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "That didn't work.");
    }
  };
  const remove = (src: DataSource) =>
    void run(async () => {
      await ws(`/sources/${src.id}`, { method: "DELETE" });
      patchState((s) => ({ ...s, sources: s.sources.filter((x) => x.id !== src.id) }));
    });
  const finishedAlready = (src: DataSource) => {
    if (isLive(src.integrationId) && src.status !== "syncing") onSynced?.();
  };
  const syncNow = (src: DataSource) =>
    void run(async () => {
      const next = await ws<DataSource>(`/sources/${src.id}/sync`, { method: "POST" });
      patchState((s) => ({ ...s, sources: s.sources.map((x) => (x.id === src.id ? next : x)) }));
      finishedAlready(next);
    });

  return (
    <div>
      <div className="mb-4 grid gap-2 sm:grid-cols-2">
        <button type="button" onClick={() => setSyncing(true)} className="flex items-center gap-3 rounded-xl border border-line bg-surface p-3 text-left transition-colors hover:border-line-strong hover:bg-subtle">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-subtle text-fg-2"><Plug size={16} /></span>
          <span>
            <span className="block text-sm font-medium">Sync from a CRM or sheet</span>
            <span className="block text-xs text-fg-3">HubSpot, Salesforce, GoHighLevel, Twenty, Google Sheets…</span>
          </span>
        </button>
        <button type="button" onClick={onImport} className="flex items-center gap-3 rounded-xl border border-line bg-surface p-3 text-left transition-colors hover:border-line-strong hover:bg-subtle">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-subtle text-fg-2"><Upload size={16} /></span>
          <span>
            <span className="block text-sm font-medium">Import a CSV</span>
            <span className="block text-xs text-fg-3">Pick the columns and what each one is</span>
          </span>
        </button>
      </div>

      {problem && <p className="mb-3 text-sm text-rose-700 dark:text-rose-400">{problem}</p>}
      <div className="card overflow-hidden">
        <table className="w-full table-fixed text-sm">
          <thead className="bg-subtle/60 text-left">
            <tr>
              <th className="metric-label px-4 py-2.5 font-normal">Source</th>
              <th className="metric-label hidden w-36 px-4 py-2.5 font-normal md:table-cell">List</th>
              <th className="metric-label hidden w-24 px-4 py-2.5 font-normal sm:table-cell">Contacts</th>
              <th className="metric-label hidden w-40 px-4 py-2.5 font-normal lg:table-cell">Last sync</th>
              <th className="metric-label w-28 px-4 py-2.5 text-right font-normal" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {app.sources.map((src) => {
              const info = src.integrationId ? integrationInfo(src.integrationId) : undefined;
              return (
                <tr key={src.id}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      {info ? <IntegrationLogo info={info} size="sm" /> : <span className="flex h-6 w-6 items-center justify-center rounded-md border border-line"><FileSpreadsheet size={13} className="text-fg-3" /></span>}
                      <div className="min-w-0">
                        <div className="truncate font-medium">{src.name}</div>
                        <div className="truncate text-xs text-fg-3">
                          {src.kind === "sync" ? (isLive(src.integrationId) ? `${EVERY[src.syncEvery ?? "1h"]} · name, phone, email${src.skipped ? ` · ${src.skipped} without a number left out` : ""}` : `${EVERY[src.syncEvery ?? "1h"]} · ${src.fieldKeys.length} fields`) : `CSV import · ${src.fieldKeys.length} fields`}
                        </div>
                        {src.status === "error" && src.error && <div className="truncate text-xs text-rose-700 dark:text-rose-300">{src.error}</div>}
                      </div>
                    </div>
                  </td>
                  <td className="hidden truncate px-4 py-3 text-fg-2 md:table-cell">{src.list}</td>
                  <td className="hidden px-4 py-3 font-mono text-xs sm:table-cell">{src.rows}</td>
                  <td className="hidden px-4 py-3 text-fg-3 lg:table-cell">{src.status === "syncing" ? <Badge tone="blue" dot>{isLive(src.integrationId) ? "Syncing…" : "First sync waiting"}</Badge> : src.status === "error" ? <Badge tone="red" dot>Sync failed</Badge> : relativeTime(src.lastSyncAt)}</td>
                  <td className="px-4 py-3 text-right">
                    {src.kind === "sync" && (
                      <button type="button" className="btn-icon h-8 w-8" onClick={() => syncNow(src)} aria-label="Sync now" title="Sync now"><RefreshCw size={14} /></button>
                    )}
                    <button type="button" className="btn-icon h-8 w-8 hover:text-rose-600" onClick={() => remove(src)} aria-label="Remove source" title="Remove source (contacts stay)"><Trash2 size={14} /></button>
                  </td>
                </tr>
              );
            })}
            {app.sources.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-sm text-fg-3">No sources yet. Sync a CRM or import a CSV.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <SyncSheet open={syncing} onClose={() => setSyncing(false)} onCreated={finishedAlready} />
    </div>
  );
}

function SyncSheet({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (src: DataSource) => void }) {
  const app = useApp();
  const candidates = app.integrations.filter((i) => i.connected && integrationInfo(i.id)?.syncsContacts);
  const [integrationId, setIntegrationId] = useState<string>("");
  const [object, setObject] = useState("Contacts");
  const [list, setList] = useState("");
  const [every, setEvery] = useState<keyof typeof EVERY>("15m");
  const [picked, setPicked] = useState<Record<string, FieldType | null>>(() => Object.fromEntries(CRM_PROPERTIES.map((p) => [p.name, p.type])));
  const chosen = integrationId || candidates[0]?.id || "";
  const info = chosen ? integrationInfo(chosen) : undefined;

  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const create = async () => {
    if (!info) return;
    setBusy(true);
    setProblem(null);
    try {
      const fields = isLive(info.id) ? [] : CRM_PROPERTIES.filter((p) => !p.target && picked[p.name]).map((p) => ({ key: toFieldKey(p.name), label: p.name, type: picked[p.name] as FieldType }));
      const out = await ws<{ source: DataSource; fieldDefs: FieldDef[] }>("/sources", { body: { integrationId: info.id, object, list: list.trim(), syncEvery: every, fields } });
      patchState((s) => ({ ...s, fieldDefs: out.fieldDefs, sources: [out.source, ...s.sources] }));
      onCreated(out.source);
      onClose();
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "Couldn't start syncing.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Sync contacts" size="lg" footer={
        info && (
          <div className="space-y-2">
            {problem && <p className="text-sm text-rose-700 dark:text-rose-400">{problem}</p>}
            <button type="button" className="btn-primary w-full" disabled={busy} onClick={() => void create()}>{busy ? "Starting…" : "Start syncing"}</button>
          </div>
        )
      }>
      {candidates.length === 0 ? (
        <div className="space-y-3 text-sm">
          <p className="text-fg-2">Connect a CRM or a sheet first.</p>
          <Link href="/integrations" className="btn-secondary">Open Integrations</Link>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="grid gap-2 sm:grid-cols-2">
            {candidates.map((c) => {
              const i = integrationInfo(c.id);
              if (!i) return null;
              return (
                <button key={c.id} type="button" onClick={() => setIntegrationId(c.id)} className={clsx("flex items-center gap-2.5 rounded-lg border p-2.5 text-left transition-colors", chosen === c.id ? "border-fg" : "border-line hover:border-line-strong")}>
                  <IntegrationLogo info={i} size="sm" />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{i.name}</span>
                    <span className="block truncate text-xs text-fg-3">{c.account}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {!isLive(info?.id) && (
              <Field label="Records">
                <select className="field" value={object} onChange={(e) => setObject(e.target.value)}>
                  {["Contacts", "Leads", "Deals", "Companies"].map((o) => <option key={o}>{o}</option>)}
                </select>
              </Field>
            )}
            <Field label="Check for changes">
              <select className="field" value={every} onChange={(e) => setEvery(e.target.value as keyof typeof EVERY)}>
                {Object.entries(EVERY).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </select>
            </Field>
          </div>
          <Field label="List" hint="Synced contacts land here. New records join it as they appear, so a campaign on this list can call them right away.">
            <input className="field" value={list} onChange={(e) => setList(e.target.value)} placeholder={info ? `${info.name} ${object.toLowerCase()}` : ""} />
          </Field>
          {isLive(info?.id) ? (
            <p className="text-sm text-fg-2">Brings in each person&rsquo;s name, phone and email, and keeps them up to date. People without a phone number are left out, since agents can only call numbers. Someone already in Contacts with the same number is updated, not added twice.</p>
          ) : (
          <div>
            <div className="mb-2 flex items-baseline justify-between">
              <span className="label mb-0">Properties to bring in</span>
              <span className="text-xs text-fg-3">{Object.values(picked).filter(Boolean).length} of {CRM_PROPERTIES.length}</span>
            </div>
            <div className="divide-y divide-line rounded-lg border border-line">
              {CRM_PROPERTIES.map((p) => (
                <label key={p.name} className="flex items-center gap-3 px-3 py-2">
                  <input type="checkbox" className="accent-[rgb(var(--fg))]" checked={Boolean(picked[p.name])} disabled={Boolean(p.target)} onChange={(e) => setPicked((x) => ({ ...x, [p.name]: e.target.checked ? p.type : null }))} />
                  <span className="flex-1 text-sm">{p.name}</span>
                  {p.target ? (
                    <span className="text-xs text-fg-3">Contact {p.target}</span>
                  ) : (
                    <select className="field h-7 w-28 py-0 text-xs" value={picked[p.name] ?? p.type} disabled={!picked[p.name]} onChange={(e) => setPicked((x) => ({ ...x, [p.name]: e.target.value as FieldType }))} aria-label={`${p.name} type`}>
                      {(["text", "number", "date", "yesno", "choice", "phone", "email"] as FieldType[]).map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  )}
                </label>
              ))}
            </div>
            <p className="hint">These are {info?.name}&rsquo;s common properties. Once the live connection is on, the list comes from your account, custom properties included.</p>
          </div>
          )}
        </div>
      )}
    </Sheet>
  );
}
