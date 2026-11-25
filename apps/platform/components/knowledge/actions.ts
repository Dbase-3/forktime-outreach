"use client";

// Adding and refreshing knowledge documents. Web documents are read by the
// server route (app/api/knowledge/fetch); text files are read in the browser;
// PDFs and Word files wait for the backend.

import { newId } from "@/lib/flow-tree";
import { MAX_FILE_BYTES, READABLE_FILE } from "@/lib/knowledge";
import { nowIso, update } from "@/lib/store";
import type { KnowledgeDoc } from "@/lib/types";

export type UrlMode = "page" | "sitemap" | "site";

interface AddOptions {
  availableToAll: boolean;
  attachTo?: string; // an agent id to attach the new document to
}

function insert(doc: KnowledgeDoc, attachTo?: string): void {
  update((s) => ({
    ...s,
    knowledge: [doc, ...s.knowledge],
    flows: attachTo ? s.flows.map((f) => (f.id === attachTo ? { ...f, knowledgeIds: [...f.knowledgeIds, doc.id] } : f)) : s.flows,
  }));
}

function patch(id: string, changes: Partial<KnowledgeDoc>): void {
  update((s) => ({ ...s, knowledge: s.knowledge.map((d) => (d.id === id ? { ...d, ...changes, updatedAt: nowIso() } : d)) }));
}

async function readUrl(url: string, mode: UrlMode): Promise<{ title: string; text: string; pages: number }> {
  const res = await fetch("/api/knowledge/fetch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url, mode }) });
  const data = await res.json().catch(() => ({ error: "That address couldn't be read." }));
  if (!res.ok || data.error) throw new Error(data.error ?? "That address couldn't be read.");
  return data;
}

const KIND: Record<UrlMode, KnowledgeDoc["kind"]> = { page: "url", sitemap: "sitemap", site: "site" };

export function addUrl(url: string, mode: UrlMode, opts: AddOptions & { autoRefresh: boolean }): string {
  const id = newId("k");
  const now = nowIso();
  insert({ id, name: url.replace(/^https?:\/\//, ""), kind: KIND[mode], source: url, content: "", sizeBytes: 0, status: "reading", availableToAll: opts.availableToAll, autoRefresh: opts.autoRefresh, createdAt: now, updatedAt: now }, opts.attachTo);
  void refreshUrl(id, url, mode, true);
  return id;
}

export async function refreshUrl(id: string, url: string, mode: UrlMode, rename = false): Promise<void> {
  patch(id, { status: "reading", error: undefined });
  try {
    const { title, text, pages } = await readUrl(url, mode);
    patch(id, { status: "ready", content: text, sizeBytes: new Blob([text]).size, pages, ...(rename ? { name: title } : {}) });
  } catch (err) {
    patch(id, { status: "failed", error: err instanceof Error ? err.message : "That address couldn't be read." });
  }
}

export async function addFiles(files: File[], opts: AddOptions): Promise<void> {
  for (const file of files) {
    const id = newId("k");
    const now = nowIso();
    const base: KnowledgeDoc = { id, name: file.name, kind: "file", source: file.name, content: "", sizeBytes: file.size, status: "reading", availableToAll: opts.availableToAll, createdAt: now, updatedAt: now };
    if (file.size > MAX_FILE_BYTES) {
      insert({ ...base, status: "failed", error: "Files can be up to 15 MB." }, opts.attachTo);
      continue;
    }
    if (!READABLE_FILE.test(file.name)) {
      insert({ ...base, status: "waiting" }, opts.attachTo);
      continue;
    }
    insert(base, opts.attachTo);
    const text = await file.text();
    patch(id, { status: "ready", content: text });
  }
}

export function addText(name: string, content: string, opts: AddOptions): string {
  const id = newId("k");
  const now = nowIso();
  insert({ id, name: name.trim() || "Untitled text", kind: "text", content, sizeBytes: new Blob([content]).size, status: "ready", availableToAll: opts.availableToAll, createdAt: now, updatedAt: now }, opts.attachTo);
  return id;
}

export function setDoc(id: string, changes: Partial<KnowledgeDoc>): void {
  patch(id, changes.content !== undefined ? { ...changes, sizeBytes: new Blob([changes.content]).size } : changes);
}

export function removeDoc(id: string): void {
  update((s) => ({ ...s, knowledge: s.knowledge.filter((d) => d.id !== id), flows: s.flows.map((f) => ({ ...f, knowledgeIds: f.knowledgeIds.filter((k) => k !== id) })) }));
}

export function toggleAttached(docId: string, flowId: string, on: boolean): void {
  update((s) => ({
    ...s,
    flows: s.flows.map((f) => (f.id !== flowId ? f : { ...f, knowledgeIds: on ? [...new Set([...f.knowledgeIds, docId])] : f.knowledgeIds.filter((k) => k !== docId) })),
  }));
}

export function urlMode(doc: KnowledgeDoc): UrlMode {
  return doc.kind === "sitemap" ? "sitemap" : doc.kind === "site" ? "site" : "page";
}
