// Stored documents → the shapes the front end already uses (packages/core
// types), with string ids and a `version` for saving back.

import type { Campaign, Call, DataSource, FieldDef, Flow, Integration, KnowledgeDoc, PhoneNumber } from "@outreach/core/types";
import type { Row } from "../db/models";

const s = (v: unknown) => (v == null ? undefined : String(v));
const iso = (d: unknown) => (d instanceof Date ? d.toISOString() : typeof d === "string" ? d : new Date().toISOString());

export type Versioned<T> = T & { version: number };

export function agentOut(a: Row<"Agent">): Versioned<Flow> & { publishedVersionId?: string } {
  return { ...(a.draft as Omit<Flow, "id" | "status" | "numberId" | "updatedAt">), id: String(a._id), status: a.status as Flow["status"], numberId: s(a.numberId), publishedVersionId: s(a.publishedVersionId), updatedAt: iso(a.updatedAt), version: a.version };
}

export function campaignOut(c: Row<"Campaign">): Versioned<Campaign> {
  return { ...(c.config as Omit<Campaign, "id" | "status" | "called" | "answered" | "createdAt">), id: String(c._id), status: c.status as Campaign["status"], called: c.called, answered: c.answered, createdAt: iso(c.createdAt), version: c.version };
}

export function knowledgeOut(k: Row<"Knowledge">, withContent = false): Versioned<KnowledgeDoc> {
  return {
    id: String(k._id),
    name: k.name,
    kind: k.kind as KnowledgeDoc["kind"],
    source: k.source ?? undefined,
    content: withContent ? k.content : "",
    sizeBytes: k.sizeBytes,
    pages: k.pages ?? undefined,
    status: k.status as KnowledgeDoc["status"],
    error: k.error ?? undefined,
    availableToAll: k.availableToAll,
    autoRefresh: k.autoRefresh ?? undefined,
    createdAt: iso(k.createdAt),
    updatedAt: iso(k.updatedAt),
    version: k.version,
  };
}

export function numberOut(n: Row<"PhoneNumber">): PhoneNumber {
  return { id: String(n._id), e164: n.e164, display: n.display, country: n.country, kind: n.kind as PhoneNumber["kind"], area: n.area ?? undefined, addedAt: iso(n.createdAt) };
}

export function fieldOut(f: Row<"FieldDef">): FieldDef {
  return { key: f.key, label: f.label, type: f.type as FieldDef["type"], ...(f.choices?.length ? { choices: f.choices } : {}), ...(f.source ? { source: f.source } : {}) };
}

export function sourceOut(x: Row<"Source">): DataSource {
  return { id: String(x._id), kind: x.kind as DataSource["kind"], integrationId: x.integrationId ?? undefined, name: x.name ?? "", object: x.object ?? undefined, list: x.list ?? "", fieldKeys: x.fieldKeys ?? [], rows: x.rows, syncEvery: (x.syncEvery ?? undefined) as DataSource["syncEvery"], lastSyncAt: iso(x.lastSyncAt), status: x.status as DataSource["status"] };
}

export function integrationOut(i: Row<"Integration">): Integration {
  return { id: i.providerId, connected: i.connected, account: i.account ?? undefined, connectedAt: iso(i.createdAt) };
}

export function callOut(c: Row<"Call">): Call {
  return {
    id: String(c._id),
    contactId: s(c.contactId) ?? "",
    flowId: String(c.agentId),
    direction: c.direction as Call["direction"],
    startedAt: iso(c.startedAt),
    durationSec: c.durationSec,
    outcome: c.outcome,
    summary: c.summary,
    saved: (c.saved ?? {}) as Record<string, string>,
    transcript: (c.transcript ?? []) as Call["transcript"],
    recording: c.recording as Call["recording"],
    endReason: (c.endReason ?? undefined) as Call["endReason"],
    actions: c.actions ?? [],
    mood: c.mood ?? undefined,
    feedback: (c.feedback ?? null) as Call["feedback"],
    checkResults: (c.checkResults ?? undefined) as Call["checkResults"],
    live: c.live || undefined,
    lead: (c.lead ?? undefined) as Call["lead"],
    engagement: (c.engagement ?? undefined) as Call["engagement"],
    transferTo: (c.transferTo ?? undefined) as Call["transferTo"],
    test: c.test || undefined,
    path: c.path?.length ? c.path : undefined,
    missing: c.missing?.length ? c.missing : undefined,
  };
}
