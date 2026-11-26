"use client";

// Operations that aren't "type and it saves": creating, deleting, publishing,
// starting, numbers, integrations, fields. Each calls the API, then puts the
// server's answer into the store, so the screen shows the truth. Errors are
// thrown as ApiError with a message ready to show.

import type { FieldDef, FieldType, Flow, KnowledgeDoc, PhoneNumber, Campaign, Integration } from "@outreach/core/types";
import type { Offer } from "@outreach/core/numbers";
import { ws } from "./api";
import { flush, getState, patchState, type Loaded } from "./store";

type V<T> = T & { version: number };
const replaceById = <T extends { id: string }>(list: T[], item: T) => (list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [item, ...list]);

// ---- Agents ----

export async function createAgent(input: { templateId: string | null; name: string; numberId?: string }): Promise<Flow> {
  const a = await ws<V<Flow>>("/agents", { body: input });
  patchState((s) => ({ ...s, flows: [a, ...s.flows] }));
  return a;
}

export async function duplicateAgent(id: string): Promise<Flow> {
  const a = await ws<V<Flow>>(`/agents/${id}/duplicate`, { method: "POST" });
  patchState((s) => ({ ...s, flows: [a, ...s.flows] }));
  return a;
}

export async function deleteAgent(id: string): Promise<void> {
  await ws(`/agents/${id}`, { method: "DELETE" });
  patchState((s) => ({ ...s, flows: s.flows.filter((f) => f.id !== id) }));
}

async function agentCall(id: string, path: string, body: Record<string, unknown> = {}, method = "POST"): Promise<Flow> {
  await flush(); // send any draft edits first, so the version matches
  const current = (await currentFlow(id)) as V<Flow>;
  const a = await ws<V<Flow>>(`/agents/${id}${path}`, { method, body: { version: current.version, ...body } });
  patchState((s) => ({ ...s, flows: replaceById(s.flows, a) }));
  return a;
}

const read = (): Loaded | null => getState();
async function currentFlow(id: string): Promise<Flow | undefined> {
  return read()?.flows.find((f) => f.id === id);
}

export const publishAgent = (id: string) => agentCall(id, "/publish");
export const unpublishAgent = (id: string) => agentCall(id, "/unpublish");
export const setAgentNumber = (id: string, numberId: string | null) => agentCall(id, "/number", { numberId }, "PUT");

// ---- Campaigns ----

export async function createCampaign(agentId: string, name?: string): Promise<Campaign> {
  const c = await ws<V<Campaign>>("/campaigns", { body: { agentId, name } });
  patchState((s) => ({ ...s, campaigns: [c, ...s.campaigns] }));
  return c;
}

async function campaignCall(id: string, path: string): Promise<Campaign> {
  await flush();
  const current = read()?.campaigns.find((c) => c.id === id) as V<Campaign> | undefined;
  const c = await ws<V<Campaign>>(`/campaigns/${id}${path}`, { body: { version: current?.version ?? 1 } });
  patchState((s) => ({ ...s, campaigns: replaceById(s.campaigns, c) }));
  return c;
}
export const startCampaign = (id: string) => campaignCall(id, "/start");
export const pauseCampaign = (id: string) => campaignCall(id, "/pause");

export async function deleteCampaign(id: string): Promise<void> {
  await ws(`/campaigns/${id}`, { method: "DELETE" });
  patchState((s) => ({ ...s, campaigns: s.campaigns.filter((c) => c.id !== id) }));
}

// ---- Knowledge ----

export async function addKnowledge(input: { kind: KnowledgeDoc["kind"]; name?: string; source?: string; content?: string; availableToAll: boolean; attachTo?: string }): Promise<KnowledgeDoc> {
  const doc = await ws<V<KnowledgeDoc>>("/knowledge", { body: input });
  patchState((s) => ({
    ...s,
    knowledge: replaceById(s.knowledge, { ...doc, content: "" }),
    flows: input.attachTo ? s.flows.map((f) => (f.id === input.attachTo && !f.knowledgeIds.includes(doc.id) ? { ...f, knowledgeIds: [...f.knowledgeIds, doc.id], version: (f as V<Flow>).version + 1 } : f)) : s.flows,
  }));
  return doc;
}

/** A file (PDF, Word .docx or text): sent as it is, read on the server. */
export async function uploadKnowledge(file: File, opts: { availableToAll: boolean; attachTo?: string }): Promise<KnowledgeDoc> {
  const form = new FormData();
  form.append("availableToAll", String(opts.availableToAll));
  if (opts.attachTo) form.append("attachTo", opts.attachTo);
  form.append("file", file);
  const doc = await ws<V<KnowledgeDoc>>("/knowledge/upload", { body: form });
  patchState((s) => ({
    ...s,
    knowledge: replaceById(s.knowledge, { ...doc, content: "" }),
    flows: opts.attachTo ? s.flows.map((f) => (f.id === opts.attachTo && !f.knowledgeIds.includes(doc.id) ? { ...f, knowledgeIds: [...f.knowledgeIds, doc.id], version: (f as V<Flow>).version + 1 } : f)) : s.flows,
  }));
  return doc;
}

export async function refreshKnowledge(id: string): Promise<void> {
  const doc = await ws<V<KnowledgeDoc>>(`/knowledge/${id}/refresh`, { method: "POST" });
  patchState((s) => ({ ...s, knowledge: replaceById(s.knowledge, { ...doc, content: "" }) }));
}

export async function deleteKnowledge(id: string): Promise<void> {
  await ws(`/knowledge/${id}`, { method: "DELETE" });
  patchState((s) => ({ ...s, knowledge: s.knowledge.filter((k) => k.id !== id) }));
}

export const knowledgeContent = (id: string) => ws<V<KnowledgeDoc>>(`/knowledge/${id}`);

/** While a web document is being read on the server, check back for its result. */
export async function refreshReading(): Promise<void> {
  const list = await ws<V<KnowledgeDoc>[]>("/knowledge");
  patchState((s) => ({ ...s, knowledge: list }));
}

export async function saveKnowledgeText(id: string, version: number, content: string): Promise<V<KnowledgeDoc>> {
  const doc = await ws<V<KnowledgeDoc>>(`/knowledge/${id}`, { method: "PATCH", body: { version, content } });
  patchState((s) => ({ ...s, knowledge: replaceById(s.knowledge, { ...doc, content: "" }) }));
  return doc;
}

// ---- Fields ----

export async function addField(def: FieldDef): Promise<void> {
  const f = await ws<FieldDef>("/fields", { body: def });
  patchState((s) => ({ ...s, fieldDefs: [...s.fieldDefs, f] }));
}

export async function retypeField(key: string, type: FieldType, confirm = false): Promise<void> {
  const f = await ws<FieldDef>(`/fields/${key}`, { method: "PATCH", body: { type, confirm } });
  patchState((s) => ({ ...s, fieldDefs: s.fieldDefs.map((d) => (d.key === key ? f : d)) }));
}

export async function removeField(key: string): Promise<void> {
  await ws(`/fields/${key}`, { method: "DELETE" });
  patchState((s) => ({ ...s, fieldDefs: s.fieldDefs.filter((d) => d.key !== key) }));
}

// ---- Numbers ----

export const searchNumbers = (country: string, kind: string, area: string) => ws<Offer[]>("/numbers/search", { body: { country, kind, area } });

export async function addNumber(offer: Offer): Promise<PhoneNumber> {
  const n = await ws<PhoneNumber>("/numbers", { body: { country: offer.country, kind: offer.kind, area: offer.area ?? "", e164: offer.e164 } });
  patchState((s) => ({ ...s, numbers: [...s.numbers, n] }));
  return n;
}

export async function releaseNumber(id: string): Promise<void> {
  await ws(`/numbers/${id}`, { method: "DELETE" });
  patchState((s) => ({ ...s, numbers: s.numbers.filter((n) => n.id !== id) }));
}

// ---- Integrations ----

export async function connectIntegration(provider: string, account: string): Promise<void> {
  const i = await ws<Integration>(`/integrations/${provider}`, { method: "PUT", body: { account } });
  patchState((s) => ({ ...s, integrations: [...s.integrations.filter((x) => x.id !== provider), i] }));
}

export async function disconnectIntegration(provider: string): Promise<void> {
  await ws(`/integrations/${provider}`, { method: "DELETE" });
  patchState((s) => ({ ...s, integrations: s.integrations.filter((x) => x.id !== provider) }));
}
