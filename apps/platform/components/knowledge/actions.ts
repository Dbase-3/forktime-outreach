"use client";

// Adding and changing knowledge documents, through the API. Web documents are
// read on the server by a job (public addresses only); text files are read in
// the browser and sent as text; PDFs and Word files wait for server reading.

import { MAX_FILE_BYTES, READABLE_FILE } from "@outreach/core/knowledge";
import type { KnowledgeDoc } from "@outreach/core/types";
import { addKnowledge, deleteKnowledge, refreshKnowledge } from "@/lib/actions";
import { update } from "@/lib/store";

export type UrlMode = "page" | "sitemap" | "site";

interface AddOptions {
  availableToAll: boolean;
  attachTo?: string; // an agent id to attach the new document to
}

const KIND: Record<UrlMode, KnowledgeDoc["kind"]> = { page: "url", sitemap: "sitemap", site: "site" };

export async function addUrl(url: string, mode: UrlMode, opts: AddOptions & { autoRefresh: boolean }): Promise<string> {
  const doc = await addKnowledge({ kind: KIND[mode], source: url, availableToAll: opts.availableToAll, attachTo: opts.attachTo });
  return doc.id;
}

export async function refreshUrl(id: string): Promise<void> {
  await refreshKnowledge(id);
}

const MAX_TEXT_BYTES = 2 * 1024 * 1024;

/** Text files are sent as text; other kinds wait for server reading (a later phase). */
export async function addFiles(files: File[], opts: AddOptions): Promise<string[]> {
  const problems: string[] = [];
  for (const file of files) {
    if (file.size > MAX_FILE_BYTES) {
      problems.push(`${file.name}: files can be up to 15 MB.`);
      continue;
    }
    if (!READABLE_FILE.test(file.name)) {
      problems.push(`${file.name}: PDF and Word files can be read once server reading is on. Paste the text for now.`);
      continue;
    }
    if (file.size > MAX_TEXT_BYTES) {
      problems.push(`${file.name}: text files can be up to 2 MB.`);
      continue;
    }
    await addKnowledge({ kind: "file", name: file.name, content: await file.text(), availableToAll: opts.availableToAll, attachTo: opts.attachTo });
  }
  return problems;
}

export async function addText(name: string, content: string, opts: AddOptions): Promise<string> {
  const doc = await addKnowledge({ kind: "text", name: name.trim() || "Untitled text", content, availableToAll: opts.availableToAll, attachTo: opts.attachTo });
  return doc.id;
}

/** Name, "available to all" and "keep up to date" save in the background (lib/store). */
export function setDoc(id: string, changes: Pick<Partial<KnowledgeDoc>, "name" | "availableToAll" | "autoRefresh">): void {
  update((s) => ({ ...s, knowledge: s.knowledge.map((d) => (d.id === id ? { ...d, ...changes } : d)) }));
}

export async function removeDoc(id: string): Promise<void> {
  await deleteKnowledge(id);
}

/** Attaching is part of the agent's draft, so it saves with the agent. */
export function toggleAttached(docId: string, flowId: string, on: boolean): void {
  update((s) => ({
    ...s,
    flows: s.flows.map((f) => (f.id !== flowId ? f : { ...f, knowledgeIds: on ? [...new Set([...f.knowledgeIds, docId])] : f.knowledgeIds.filter((k) => k !== docId) })),
  }));
}

export function urlMode(doc: KnowledgeDoc): UrlMode {
  return doc.kind === "sitemap" ? "sitemap" : doc.kind === "site" ? "site" : "page";
}
