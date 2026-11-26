"use strict";
// Stored documents → the shapes the front end already uses (packages/core
// types), with string ids and a `version` for saving back.
Object.defineProperty(exports, "__esModule", { value: true });
exports.agentOut = agentOut;
exports.campaignOut = campaignOut;
exports.knowledgeOut = knowledgeOut;
exports.numberOut = numberOut;
exports.fieldOut = fieldOut;
exports.sourceOut = sourceOut;
exports.integrationOut = integrationOut;
exports.callOut = callOut;
const s = (v) => (v == null ? undefined : String(v));
const iso = (d) => (d instanceof Date ? d.toISOString() : typeof d === "string" ? d : new Date().toISOString());
function agentOut(a) {
    return { ...a.draft, id: String(a._id), status: a.status, numberId: s(a.numberId), publishedVersionId: s(a.publishedVersionId), updatedAt: iso(a.updatedAt), version: a.version };
}
function campaignOut(c) {
    return { ...c.config, id: String(c._id), status: c.status, called: c.called, answered: c.answered, createdAt: iso(c.createdAt), version: c.version };
}
function knowledgeOut(k, withContent = false) {
    return {
        id: String(k._id),
        name: k.name,
        kind: k.kind,
        source: k.source ?? undefined,
        content: withContent ? k.content : "",
        sizeBytes: k.sizeBytes,
        pages: k.pages ?? undefined,
        status: k.status,
        error: k.error ?? undefined,
        availableToAll: k.availableToAll,
        autoRefresh: k.autoRefresh ?? undefined,
        createdAt: iso(k.createdAt),
        updatedAt: iso(k.updatedAt),
        version: k.version,
    };
}
function numberOut(n) {
    return { id: String(n._id), e164: n.e164, display: n.display, country: n.country, kind: n.kind, area: n.area ?? undefined, addedAt: iso(n.createdAt) };
}
function fieldOut(f) {
    return { key: f.key, label: f.label, type: f.type, ...(f.choices?.length ? { choices: f.choices } : {}), ...(f.source ? { source: f.source } : {}) };
}
function sourceOut(x) {
    return { id: String(x._id), kind: x.kind, integrationId: x.integrationId ?? undefined, name: x.name ?? "", object: x.object ?? undefined, list: x.list ?? "", fieldKeys: x.fieldKeys ?? [], rows: x.rows, syncEvery: (x.syncEvery ?? undefined), lastSyncAt: iso(x.lastSyncAt), status: x.status };
}
function integrationOut(i) {
    return { id: i.providerId, connected: i.connected, account: i.account ?? undefined, connectedAt: iso(i.createdAt) };
}
function callOut(c) {
    return {
        id: String(c._id),
        contactId: s(c.contactId) ?? "",
        flowId: String(c.agentId),
        direction: c.direction,
        startedAt: iso(c.startedAt),
        durationSec: c.durationSec,
        outcome: c.outcome,
        summary: c.summary,
        saved: (c.saved ?? {}),
        transcript: (c.transcript ?? []),
        recording: c.recording,
        endReason: (c.endReason ?? undefined),
        actions: c.actions ?? [],
        mood: c.mood ?? undefined,
        feedback: (c.feedback ?? null),
        checkResults: (c.checkResults ?? undefined),
        live: c.live || undefined,
        lead: (c.lead ?? undefined),
        engagement: (c.engagement ?? undefined),
        transferTo: (c.transferTo ?? undefined),
    };
}
//# sourceMappingURL=serialize.js.map