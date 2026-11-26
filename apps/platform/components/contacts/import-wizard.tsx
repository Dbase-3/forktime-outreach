"use client";

// Import a CSV in three steps: the file → which columns to use and as what →
// the list it goes into. Columns can be anything; each becomes a typed field.
// The browser reads the file for the preview; the server imports it as a job
// (1,000 rows at a time, numbers already here are skipped) and the sheet shows
// its progress.

import clsx from "clsx";
import { FileUp } from "lucide-react";
import { useEffect, useState } from "react";
import { analyzeCsv, planImport, type ImportColumn, type Target } from "@outreach/core/contacts-table";
import { toFieldKey } from "@outreach/core/flow-tree";
import { countryOfZone } from "@outreach/core/phone";
import { ws } from "@/lib/api";
import { importStatus, startImport, type ImportStatus } from "@/lib/contacts-api";
import { patchState, useApp } from "@/lib/store";
import type { DataSource, FieldDef, FieldType } from "@outreach/core/types";
import { Field, Sheet } from "../ui";

const TYPES: { value: FieldType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "yesno", label: "Yes / No" },
  { value: "choice", label: "Choice" },
  { value: "phone", label: "Phone" },
  { value: "email", label: "Email" },
];

const MAX_CSV_BYTES = 15 * 1024 * 1024;

export function ImportWizard({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone?: () => void }) {
  const app = useApp();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [fileName, setFileName] = useState("");
  const [csv, setCsv] = useState("");
  const [columns, setColumns] = useState<ImportColumn[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [list, setList] = useState("Imported");
  const [job, setJob] = useState<ImportStatus | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const reset = () => {
    setStep(1);
    setColumns([]);
    setRows([]);
    setCsv("");
    setFileName("");
    setJob(null);
    setProblem(null);
  };
  const close = () => {
    // A running import carries on on the server; closing only hides it.
    reset();
    onClose();
  };
  const read = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_CSV_BYTES) return setProblem("CSV files can be up to 15 MB. Split it into smaller files.");
    const text = await file.text();
    const parsed = analyzeCsv(text, app.fieldDefs);
    setProblem(null);
    setCsv(text);
    setFileName(file.name);
    setColumns(parsed.columns);
    setRows(parsed.rows);
    setList(file.name.replace(/\.csv$/i, ""));
    setStep(2);
  };
  const setCol = (index: number, patch: Partial<ImportColumn>) => setColumns((cs) => cs.map((c) => (c.index === index ? { ...c, ...patch } : c)));
  // The preview: numbers repeated inside the file are counted here; ones already in the workspace are found by the server.
  const plan = step === 3 ? planImport(columns, rows, list, app.fieldDefs, "preview", [], countryOfZone(app.settings.timezone)) : null;
  const hasPhone = columns.some((c) => c.target === "phone");

  // When the import ends (it can end before the first answer comes back), bring in the new fields, the source and the count.
  const finished = async (done: ImportStatus) => {
    const [fieldDefs, sources] = await Promise.all([ws<FieldDef[]>("/fields"), ws<DataSource[]>("/sources")]);
    patchState((s) => ({ ...s, fieldDefs, sources, counts: { ...s.counts, contacts: s.counts.contacts + done.created } }));
    onDone?.();
  };

  const finish = async () => {
    if (!plan) return;
    setProblem(null);
    try {
      const started = await startImport({ fileName, csv, columns, list: list.trim() });
      setJob(started);
      setStep(4);
      if (started.status === "done" || started.status === "failed") await finished(started);
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "Couldn't start the import.");
    }
  };

  // While the import runs, check its progress.
  const running = job && (job.status === "queued" || job.status === "running");
  useEffect(() => {
    if (!job || !running) return;
    const t = setTimeout(async () => {
      try {
        const next = await importStatus(job.id);
        setJob(next);
        if (next.status === "done" || next.status === "failed") await finished(next);
      } catch {
        // try again on the next tick
        setJob({ ...job });
      }
    }, 700);
    return () => clearTimeout(t);
  }, [job, running, onDone]);

  return (
    <Sheet
      open={open}
      onClose={close}
      title="Import contacts"
      size="xl"
      subheader={
        <div className="flex items-center gap-4 pb-3 text-xs">
          {["File", "Columns", "List", "Import"].map((label, i) => (
            <span key={label} className={clsx("flex items-center gap-1.5", step === i + 1 ? "font-medium text-fg" : "text-fg-3")}>
              <span className={clsx("flex h-5 w-5 items-center justify-center rounded-full font-mono text-2xs", step > i + 1 ? "bg-fg text-background" : step === i + 1 ? "border border-fg" : "border border-line-strong")}>{i + 1}</span>
              {label}
            </span>
          ))}
        </div>
      }
      footer={
        step === 1 ? null : step === 4 ? (
          <div className="flex">
            <button type="button" className="btn-primary ml-auto" onClick={close}>{running ? "Hide (it keeps going)" : "Done"}</button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button type="button" className="btn-ghost" onClick={() => setStep((s) => (s === 3 ? 2 : 1))}>Back</button>
            {problem && <span className="text-xs text-rose-700 dark:text-rose-400">{problem}</span>}
            {step === 2 && !hasPhone && <span className="text-xs text-amber-700 dark:text-amber-400">Pick the column with phone numbers.</span>}
            <span className="flex-1" />
            {step === 2 && <button type="button" className="btn-primary" disabled={!hasPhone} onClick={() => setStep(3)}>Continue</button>}
            {step === 3 && plan && <button type="button" className="btn-primary" disabled={plan.contacts.length === 0} onClick={() => void finish()}>Import up to {plan.contacts.length.toLocaleString()} contacts</button>}
          </div>
        )
      }
    >
      {step === 1 && problem && <p className="mb-3 text-sm text-rose-700 dark:text-rose-400">{problem}</p>}
      {step === 1 && (
        <label className="flex cursor-pointer flex-col items-center rounded-xl border-2 border-dashed border-line-strong px-6 py-12 text-center transition-colors hover:bg-subtle">
          <FileUp size={24} className="text-fg-3" />
          <span className="mt-3 text-sm font-medium">Choose a CSV file</span>
          <span className="mt-1 max-w-sm text-xs text-fg-3">Any columns. You pick which to bring in and what each one is. Exports from Excel, Google Sheets and most CRMs work.</span>
          <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => void read(e.target.files?.[0])} />
        </label>
      )}

      {step === 2 && (
        <div>
          <p className="mb-3 text-sm text-fg-3">
            <span className="font-medium text-fg">{fileName}</span> · {rows.length} rows · {columns.length} columns
          </p>
          <div className="overflow-hidden rounded-lg border border-line">
            <table className="w-full text-sm">
              <thead className="bg-subtle text-left">
                <tr>
                  <th className="metric-label px-3 py-2 font-normal">Column</th>
                  <th className="metric-label px-3 py-2 font-normal">Goes to</th>
                  <th className="metric-label w-32 px-3 py-2 font-normal">Type</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {columns.map((col) => (
                  <ColumnRow key={col.index} col={col} defs={app.fieldDefs.map((d) => ({ key: d.key, label: d.label }))} onChange={(patch) => setCol(col.index, patch)} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {step === 3 && plan && (
        <div className="space-y-5">
          <Field label="Put them in a list" hint="Campaigns can call a whole list.">
            <input className="field" value={list} onChange={(e) => setList(e.target.value)} />
          </Field>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Figure label="Contacts" value={plan.contacts.length} />
            <Figure label="New fields" value={plan.newFields.length} />
            <Figure label="Skipped" value={plan.skipped} hint="no phone number" />
            <Figure label="Repeated" value={plan.duplicates} hint="same number twice in the file" />
          </dl>
          <p className="text-xs text-fg-3">Numbers already in your contacts are skipped while importing, so no one is added twice.</p>
          {plan.newFields.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {plan.newFields.map((f) => (
                <span key={f.key} className="chip h-6 bg-muted text-fg-2">{f.label} <span className="font-mono text-fg-4">{f.type}</span></span>
              ))}
            </div>
          )}
        </div>
      )}

      {step === 4 && job && (
        <div className="space-y-5">
          <div>
            <div className="mb-2 flex items-baseline justify-between text-sm">
              <span className="font-medium">{job.status === "done" ? "Imported" : job.status === "failed" ? "The import stopped" : "Importing…"}</span>
              <span className="font-mono text-xs text-fg-3">{job.done.toLocaleString()} / {(job.total || rows.length).toLocaleString()} rows</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-fg transition-[width]" style={{ width: `${Math.round((job.done / Math.max(1, job.total || rows.length)) * 100)}%` }} />
            </div>
            {job.error && <p className="mt-2 text-sm text-rose-700 dark:text-rose-400">{job.error}</p>}
          </div>
          <dl className="grid grid-cols-3 gap-3">
            <Figure label="Added" value={job.created} />
            <Figure label="Already here" value={job.duplicates} hint="same number, not added twice" />
            <Figure label="Skipped" value={job.skipped} hint="no phone number" />
          </dl>
        </div>
      )}
    </Sheet>
  );
}

function ColumnRow({ col, defs, onChange }: { col: ImportColumn; defs: { key: string; label: string }[]; onChange: (p: Partial<ImportColumn>) => void }) {
  const skipped = col.target === "skip";
  const isField = col.target.startsWith("field:");
  const key = isField ? col.target.slice(6) : "";
  const existing = defs.some((d) => d.key === key);
  const newKey = `field:${toFieldKey(col.name)}` as Target;
  return (
    <tr className={clsx(skipped && "opacity-50")}>
      <td className="px-3 py-2.5 align-top">
        <div className="font-medium">{col.name}</div>
        <div className="mt-0.5 truncate text-xs text-fg-3">{col.samples.join(" · ") || "Empty"}</div>
      </td>
      <td className="px-3 py-2.5 align-top">
        <select
          className="field h-8 py-0 text-sm"
          value={isField && !existing ? "new" : col.target}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "new") onChange({ target: newKey, label: col.name });
            else onChange({ target: v as Target, type: v === "phone" ? "phone" : v === "email" ? "email" : col.type });
          }}
          aria-label={`Where ${col.name} goes`}
        >
          <option value="skip">Don&rsquo;t import</option>
          <optgroup label="Contact">
            <option value="name">Full name</option>
            <option value="first_name">First name</option>
            <option value="last_name">Last name</option>
            <option value="phone">Phone</option>
            <option value="email">Email</option>
          </optgroup>
          <optgroup label="Fields">
            <option value="new">New field: {col.name}</option>
            {defs.filter((d) => d.key !== "first_name").map((d) => (
              <option key={d.key} value={`field:${d.key}`}>{d.label}</option>
            ))}
          </optgroup>
        </select>
        {isField && !existing && <input className="field mt-1.5 h-8 py-0 text-sm" value={col.label} onChange={(e) => onChange({ label: e.target.value })} aria-label="New field name" />}
      </td>
      <td className="px-3 py-2.5 align-top">
        <select className="field h-8 w-28 py-0 text-sm" value={col.type} disabled={!isField || existing} onChange={(e) => onChange({ type: e.target.value as FieldType })} aria-label={`${col.name} type`}>
          {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </td>
    </tr>
  );
}

function Figure({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="rounded-lg border border-line p-3">
      <dt className="text-xs text-fg-3">{label}</dt>
      <dd className="font-mono text-lg font-medium tabular-nums">{value.toLocaleString()}</dd>
      {hint && <div className="text-2xs text-fg-4">{hint}</div>}
    </div>
  );
}
