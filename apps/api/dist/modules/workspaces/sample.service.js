"use strict";
// A demo workspace from the same sample the prototype shows (@outreach/core
// sample.ts): agents, numbers, knowledge, contacts, campaigns, calls. Sample
// ids ("f_lead", "c_3") are mapped to new ObjectIds; links between them kept.
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SampleService = void 0;
const common_1 = require("@nestjs/common");
const mongoose_1 = require("@nestjs/mongoose");
const sample_1 = require("@outreach/core/sample");
const phone_1 = require("@outreach/core/phone");
const phone_2 = require("@outreach/core/phone");
const mongoose_2 = require("mongoose");
const typed_fields_1 = require("../contacts/typed-fields");
let SampleService = class SampleService {
    agents;
    versions;
    numbers;
    knowledge;
    fields;
    contacts;
    sources;
    campaigns;
    calls;
    integrations;
    constructor(agents, versions, numbers, knowledge, fields, contacts, sources, campaigns, calls, integrations) {
        this.agents = agents;
        this.versions = versions;
        this.numbers = numbers;
        this.knowledge = knowledge;
        this.fields = fields;
        this.contacts = contacts;
        this.sources = sources;
        this.campaigns = campaigns;
        this.calls = calls;
        this.integrations = integrations;
    }
    /** Fills an empty workspace with the sample. Numbers get workspace-unique fictional E.164s. */
    async fill(workspaceId, now = new Date()) {
        const s = (0, sample_1.seedState)(now);
        const ids = new Map();
        const idOf = (old) => {
            if (!ids.has(old))
                ids.set(old, new mongoose_2.Types.ObjectId());
            return ids.get(old);
        };
        const country = (0, phone_2.countryOfZone)(s.settings.timezone);
        const ws = { workspaceId };
        // Sample numbers are shared fictional ones; make them unique per workspace (still in the 5550 drama range).
        const suffix = String(workspaceId).slice(-4).replace(/[^0-9]/g, "7").padStart(4, "1");
        await this.numbers.insertMany(s.numbers.map((n, i) => ({ ...ws, _id: idOf(n.id), e164: `${n.e164.slice(0, -4)}${suffix.slice(0, 3)}${i}`, display: `${n.display.slice(0, -4)}${suffix.slice(0, 3)}${i}`, country: n.country, kind: n.kind, area: n.area })));
        await this.fields.insertMany(s.fieldDefs.map((f) => ({ ...ws, ...f })));
        await this.knowledge.insertMany(s.knowledge.map((k) => ({ ...ws, _id: idOf(k.id), name: k.name, kind: k.kind, source: k.source, content: k.content, sizeBytes: k.sizeBytes, pages: k.pages, status: k.status, error: k.error, availableToAll: k.availableToAll, autoRefresh: k.autoRefresh })));
        await this.sources.insertMany(s.sources.map((x) => ({ ...ws, _id: idOf(x.id), kind: x.kind, integrationId: x.integrationId, name: x.name, object: x.object, list: x.list, fieldKeys: x.fieldKeys, rows: x.rows, syncEvery: x.syncEvery, lastSyncAt: new Date(x.lastSyncAt), status: x.status })));
        for (const f of s.flows) {
            const { id, status, numberId, updatedAt, ...draft } = f;
            const agentId = idOf(id);
            const draftOut = { ...draft, knowledgeIds: draft.knowledgeIds.map(idOf).map(String) };
            let publishedVersionId = null;
            if (status === "live") {
                publishedVersionId = new mongoose_2.Types.ObjectId();
                await this.versions.create({ ...ws, _id: publishedVersionId, agentId, n: 1, config: draftOut });
            }
            await this.agents.create({ ...ws, _id: agentId, draft: draftOut, status, numberId: numberId ? idOf(numberId) : null, publishedVersionId, updatedAt: new Date(updatedAt) });
        }
        const lastCall = new Map();
        for (const c of s.calls) {
            const prev = lastCall.get(c.contactId);
            if (!c.live && (!prev || c.startedAt > prev.at))
                lastCall.set(c.contactId, { at: c.startedAt, outcome: c.outcome });
        }
        await this.contacts.insertMany(s.contacts.map((c) => ({
            ...ws,
            _id: idOf(c.id),
            name: c.name,
            phone: c.phone,
            phoneE164: (0, phone_1.toE164)(c.phone, country),
            email: c.email,
            groups: c.groups,
            fields: (0, typed_fields_1.storeFields)(c.fields, s.fieldDefs),
            sourceId: c.sourceId ? String(idOf(c.sourceId)) : undefined,
            lastCallAt: lastCall.get(c.id) ? new Date(lastCall.get(c.id).at) : null,
            lastOutcome: lastCall.get(c.id)?.outcome ?? null,
            createdAt: new Date(c.createdAt),
        })));
        await this.campaigns.insertMany(s.campaigns.map((c) => {
            const { id, status, called, answered, createdAt, ...config } = c;
            return {
                ...ws,
                _id: idOf(id),
                config: { ...config, agentId: String(idOf(config.agentId)), followUps: config.followUps.map((f) => ({ ...f, agentId: f.agentId ? String(idOf(f.agentId)) : undefined })) },
                status,
                called,
                answered,
                createdAt: new Date(createdAt),
            };
        }));
        // Calls in batches: the sample has about a thousand.
        const callDocs = s.calls.map((c) => ({
            ...ws,
            contactId: c.contactId ? idOf(c.contactId) : null,
            agentId: idOf(c.flowId),
            direction: c.direction,
            startedAt: new Date(c.startedAt),
            durationSec: c.durationSec,
            outcome: c.outcome,
            summary: c.summary,
            saved: c.saved,
            transcript: c.transcript,
            recording: c.recording,
            endReason: c.endReason,
            actions: c.actions,
            mood: c.mood,
            feedback: c.feedback ?? null,
            checkResults: c.checkResults,
            live: c.live ?? false,
            lead: c.lead,
            engagement: c.engagement,
            transferTo: c.transferTo,
        }));
        for (let i = 0; i < callDocs.length; i += 500)
            await this.calls.insertMany(callDocs.slice(i, i + 500), { ordered: false });
        await this.integrations.insertMany(s.integrations.filter((i) => i.connected).map((i) => ({ ...ws, providerId: i.id, connected: true, account: i.account })));
        return { settings: s.settings };
    }
};
exports.SampleService = SampleService;
exports.SampleService = SampleService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, mongoose_1.InjectModel)("Agent")),
    __param(1, (0, mongoose_1.InjectModel)("AgentVersion")),
    __param(2, (0, mongoose_1.InjectModel)("PhoneNumber")),
    __param(3, (0, mongoose_1.InjectModel)("Knowledge")),
    __param(4, (0, mongoose_1.InjectModel)("FieldDef")),
    __param(5, (0, mongoose_1.InjectModel)("Contact")),
    __param(6, (0, mongoose_1.InjectModel)("Source")),
    __param(7, (0, mongoose_1.InjectModel)("Campaign")),
    __param(8, (0, mongoose_1.InjectModel)("Call")),
    __param(9, (0, mongoose_1.InjectModel)("Integration")),
    __metadata("design:paramtypes", [Object, Object, Object, Object, Object, Object, Object, Object, Object, Object])
], SampleService);
//# sourceMappingURL=sample.service.js.map