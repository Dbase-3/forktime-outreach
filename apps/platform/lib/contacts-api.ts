"use client";

// Contacts live on the server (100k+). These are the calls the Contacts
// screens make; results are cached by TanStack Query.

import type { ConditionGroup, Contact } from "@outreach/core/types";
import { currentWorkspace, request, ws } from "./api";
import { patchState } from "./store";

export type ServerContact = Contact & { version: number; lastCallAt: string | null; lastOutcome: string | null; phoneE164: string | null };
export interface ContactQuery {
  search: string;
  list: string | null;
  filter: ConditionGroup;
  sort: { key: string; dir: "asc" | "desc" } | null;
  page: number;
  pageSize: number;
}
export type Target = { ids: string[] } | { query: Pick<ContactQuery, "search" | "list" | "filter"> };

export const queryContacts = (q: ContactQuery) => ws<{ rows: ServerContact[]; total: number; page: number; pages: number }>("/contacts/query", { body: q });
export const contactLists = () => ws<string[]>("/contacts/lists");
export const getContact = (id: string) => ws<ServerContact>(`/contacts/${id}`);

export async function createContact(input: { name: string; phone: string; email?: string; groups: string[]; fields: Record<string, string> }) {
  const c = await ws<ServerContact>("/contacts", { body: input });
  patchState((s) => ({ ...s, counts: { ...s.counts, contacts: s.counts.contacts + 1 } }));
  return c;
}

export const saveContact = (id: string, version: number, patch: Partial<Pick<Contact, "name" | "phone" | "email" | "groups" | "fields">>) => ws<ServerContact>(`/contacts/${id}`, { method: "PATCH", body: { version, ...patch } });

export async function deleteContacts(target: Target) {
  const out = await ws<{ deleted: number }>("/contacts/bulk", { body: { action: "delete", target } });
  patchState((s) => ({ ...s, counts: { ...s.counts, contacts: Math.max(0, s.counts.contacts - out.deleted) } }));
  return out;
}

export const changeList = (target: Target, list: string, add: boolean) => ws<{ changed: number }>("/contacts/bulk", { body: { action: add ? "add_list" : "remove_list", list, target } });

/** Downloads a CSV of the target (streamed by the server). */
export async function exportContacts(target: Target) {
  const body = "ids" in target ? { ids: target.ids } : target.query;
  const res = await fetch(`/api/v1/w/${currentWorkspace()}/contacts/export`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
  if (!res.ok) throw new Error("Couldn't export.");
  const blob = await res.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `contacts-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** The values a table row shows, built-ins included (as core rowValues did in the browser). */
export function rowValuesOf(c: ServerContact): Record<string, string> {
  return { ...c.fields, name: c.name, phone: c.phone, email: c.email ?? "", lists: c.groups.join(", "), last_call: c.lastCallAt?.slice(0, 10) ?? "", last_outcome: c.lastOutcome ?? "", created: c.createdAt.slice(0, 10) };
}

export const startImport = (input: { fileName: string; csv: string; columns: unknown[]; list: string }) => ws<ImportStatus>("/imports", { body: input });
export const importStatus = (id: string) => ws<ImportStatus>(`/imports/${id}`);
export interface ImportStatus {
  id: string;
  status: "queued" | "running" | "done" | "failed";
  total: number;
  done: number;
  created: number;
  duplicates: number;
  skipped: number;
  problems: number;
  error: string | null;
}

/** Downloads the rows an import left out or partly read, with the reason on each. */
export async function downloadImportReport(id: string, fileName: string) {
  const res = await fetch(`/api/v1/w/${currentWorkspace()}/imports/${id}/report`, { credentials: "same-origin" });
  if (!res.ok) throw new Error("Couldn't download the report.");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(await res.blob());
  a.download = `${fileName.replace(/\.csv$/i, "")}-problems.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export { request };
