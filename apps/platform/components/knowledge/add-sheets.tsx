"use client";

// Add a web address, files, or text. Shared by the Knowledge page and an
// agent's Knowledge tab (which passes `attachTo` so the new document joins it).

import clsx from "clsx";
import { FileUp } from "lucide-react";
import { useState } from "react";
import { publicUrlProblem } from "@outreach/core/knowledge";
import { Field, Segmented, Sheet, Toggle } from "../ui";
import { addFiles, addText, addUrl, type UrlMode } from "./actions";

export type AddKind = "url" | "files" | "text";

export function AddKnowledgeSheet({ kind, onClose, attachTo }: { kind: AddKind | null; onClose: () => void; attachTo?: string }) {
  const title = kind === "url" ? "Add a web address" : kind === "files" ? "Add files" : "Write text";
  return (
    <Sheet open={kind !== null} onClose={onClose} title={title}>
      {kind === "url" && <UrlForm attachTo={attachTo} onDone={onClose} />}
      {kind === "files" && <FilesForm attachTo={attachTo} onDone={onClose} />}
      {kind === "text" && <TextForm attachTo={attachTo} onDone={onClose} />}
    </Sheet>
  );
}

/** "Available to every agent": off when adding from inside an agent (it's being attached there). */
function ShareRow({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-line p-3">
      <div>
        <div className="text-sm font-medium">Available to every agent</div>
        <div className="text-xs text-fg-3">Off: only agents you attach it to use it.</div>
      </div>
      <Toggle checked={value} onChange={onChange} label="Available to every agent" />
    </div>
  );
}

function UrlForm({ attachTo, onDone }: { attachTo?: string; onDone: () => void }) {
  const [mode, setMode] = useState<UrlMode>("page");
  const [url, setUrl] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [shared, setShared] = useState(!attachTo);
  const problem = url.trim() ? publicUrlProblem(url) : null;
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const submit = async () => {
    if (!url.trim() || problem || busy) return;
    setBusy(true);
    setFailed(null);
    try {
      await addUrl(url.trim(), mode, { autoRefresh, availableToAll: shared, attachTo });
      onDone();
    } catch (err) {
      setFailed(err instanceof Error ? err.message : "Couldn't add it.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <Segmented<UrlMode> value={mode} onChange={setMode} options={[{ value: "page", label: "Single page" }, { value: "sitemap", label: "Sitemap" }, { value: "site", label: "Whole website" }]} />
      <Field label={mode === "sitemap" ? "Sitemap address" : "Address"} hint={mode === "site" ? "Reads the page and the pages it links to on the same site, up to 20." : mode === "sitemap" ? "Reads the pages the sitemap lists, up to 20." : undefined}>
        <input className="field" autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder={mode === "sitemap" ? "https://example.com/sitemap.xml" : "https://example.com/services"} inputMode="url" />
      </Field>
      {(problem || failed) && <p className="text-sm text-rose-700 dark:text-rose-400">{problem ?? failed}</p>}
      <div className="flex items-start justify-between gap-4 rounded-lg border border-line p-3">
        <div>
          <div className="text-sm font-medium">Keep it up to date</div>
          <div className="text-xs text-fg-3">Read it again every day.</div>
        </div>
        <Toggle checked={autoRefresh} onChange={setAutoRefresh} label="Keep it up to date" />
      </div>
      <ShareRow value={shared} onChange={setShared} />
      <button type="submit" className="btn-primary w-full" disabled={!url.trim() || Boolean(problem)}>Add</button>
    </form>
  );
}

function FilesForm({ attachTo, onDone }: { attachTo?: string; onDone: () => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [fileProblems, setFileProblems] = useState<string[]>([]);
  const [shared, setShared] = useState(!attachTo);
  const [over, setOver] = useState(false);
  const pick = (list: FileList | null) => list && setFiles((f) => [...f, ...Array.from(list)]);
  return (
    <div className="space-y-4">
      <label
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files); }}
        className={clsx("flex cursor-pointer flex-col items-center rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors", over ? "border-accent bg-accent/5" : "border-line-strong hover:bg-subtle")}
      >
        <FileUp size={22} className="text-fg-3" />
        <span className="mt-2 text-sm font-medium">Drop files or browse</span>
        <span className="mt-1 text-xs text-fg-3">PDF, Word, text, Markdown, CSV · up to 15 MB each</span>
        <input type="file" multiple className="sr-only" accept=".pdf,.doc,.docx,.txt,.md,.csv,.json,.html" onChange={(e) => pick(e.target.files)} />
      </label>
      {files.length > 0 && (
        <ul className="divide-y divide-line rounded-lg border border-line text-sm">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="truncate">{f.name}</span>
              <button type="button" className="text-xs text-fg-3 hover:text-fg" onClick={() => setFiles((all) => all.filter((_, j) => j !== i))}>Remove</button>
            </li>
          ))}
        </ul>
      )}
      <ShareRow value={shared} onChange={setShared} />
      {fileProblems.length > 0 && <ul className="space-y-1 text-sm text-amber-800 dark:text-amber-300">{fileProblems.map((p) => <li key={p}>{p}</li>)}</ul>}
      <button
        type="button"
        className="btn-primary w-full"
        disabled={files.length === 0}
        onClick={async () => {
          const problems = await addFiles(files, { availableToAll: shared, attachTo });
          if (problems.length) setFileProblems(problems);
          else onDone();
        }}
      >
        Add {files.length > 1 ? `${files.length} files` : "file"}
      </button>
    </div>
  );
}

function TextForm({ attachTo, onDone }: { attachTo?: string; onDone: () => void }) {
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [shared, setShared] = useState(!attachTo);
  const [textProblem, setTextProblem] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      <Field label="Name">
        <input className="field" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Refund policy" />
      </Field>
      <Field label="Text" hint="Plain facts work best: hours, prices, policies, answers to common questions.">
        <textarea className="field min-h-56" value={content} onChange={(e) => setContent(e.target.value)} />
      </Field>
      <ShareRow value={shared} onChange={setShared} />
      {textProblem && <p className="text-sm text-rose-700 dark:text-rose-400">{textProblem}</p>}
      <button
        type="button"
        className="btn-primary w-full"
        disabled={!content.trim()}
        onClick={async () => {
          try {
            await addText(name, content, { availableToAll: shared, attachTo });
            onDone();
          } catch (err) {
            setTextProblem(err instanceof Error ? err.message : "Couldn't add it.");
          }
        }}
      >
        Add
      </button>
    </div>
  );
}
