"use strict";
// Agents: a draft the owner edits, and published versions campaigns run
// (roadmap §2.1 "No versions"). Publishing runs the same go-live checks as the
// screen (@outreach/core flowIssues) and needs a number. One agent per number
// is a database rule; a live agent can't drop its number; an agent a running
// campaign uses can't be unpublished or deleted.
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
exports.AgentsService = void 0;
const common_1 = require("@nestjs/common");
const mongoose_1 = require("@nestjs/mongoose");
const flow_tree_1 = require("@outreach/core/flow-tree");
const schemas_1 = require("@outreach/core/schemas");
const templates_1 = require("@outreach/core/templates");
const mongoose_2 = require("mongoose");
const errors_1 = require("../../common/errors");
const serialize_1 = require("../../common/serialize");
const versioned_1 = require("../../common/versioned");
const workspace_data_1 = require("../../common/workspace-data");
const zod_1 = require("../../common/zod");
let AgentsService = class AgentsService {
    agents;
    versions;
    numbers;
    campaigns;
    knowledge;
    data;
    constructor(agents, versions, numbers, campaigns, knowledge, data) {
        this.agents = agents;
        this.versions = versions;
        this.numbers = numbers;
        this.campaigns = campaigns;
        this.knowledge = knowledge;
        this.data = data;
    }
    async list(ws) {
        return (await this.agents.find({ workspaceId: ws, deletedAt: null }).sort({ updatedAt: -1 }).lean()).map(serialize_1.agentOut);
    }
    async get(ws, id) {
        const a = await this.agents.findOne({ _id: id, workspaceId: ws, deletedAt: null }).lean();
        if (!a)
            throw (0, errors_1.notFound)("That agent");
        return (0, serialize_1.agentOut)(a);
    }
    async create(ws, input) {
        const template = input.templateId ? templates_1.TEMPLATES.find((t) => t.id === input.templateId) ?? null : null;
        if (input.templateId && !template)
            throw (0, errors_1.unprocessable)("That template doesn't exist.");
        const settings = await this.data.settings(ws);
        const { id: _id, status: _s, numberId: _n, updatedAt: _u, ...draft } = (0, templates_1.flowFromTemplate)(template, new Date(), settings.timezone);
        const numberId = input.numberId ? await this.freeNumber(ws, input.numberId, null) : null;
        const doc = await this.agents.create({ workspaceId: ws, draft: { ...draft, name: input.name.trim() || draft.name }, numberId });
        return (0, serialize_1.agentOut)(doc.toObject());
    }
    async saveDraft(ws, id, version, patch) {
        const current = await this.agents.findOne({ _id: id, workspaceId: ws, deletedAt: null }).lean();
        if (!current)
            throw (0, errors_1.notFound)("That agent");
        const draft = (0, zod_1.parse)(schemas_1.AgentDraftSchema, { ...current.draft, ...patch });
        await this.checkKnowledge(ws, draft.knowledgeIds);
        return (0, serialize_1.agentOut)(await (0, versioned_1.saveVersioned)(this.agents, { _id: id, workspaceId: ws }, version, { $set: { draft } }, serialize_1.agentOut, "That agent"));
    }
    async setNumber(ws, id, version, numberId) {
        const current = await this.agents.findOne({ _id: id, workspaceId: ws, deletedAt: null }).lean();
        if (!current)
            throw (0, errors_1.notFound)("That agent");
        if (!numberId && current.status === "live")
            throw (0, errors_1.conflict)("A live agent needs a number. Switch it to draft first, or pick another number.");
        const next = numberId ? await this.freeNumber(ws, numberId, id) : null;
        try {
            return (0, serialize_1.agentOut)(await (0, versioned_1.saveVersioned)(this.agents, { _id: id, workspaceId: ws }, version, { $set: { numberId: next } }, serialize_1.agentOut, "That agent"));
        }
        catch (err) {
            if (err.code === 11000)
                throw await this.numberTaken(ws, numberId);
            throw err;
        }
    }
    async publish(ws, id, version, userId) {
        const current = await this.agents.findOne({ _id: id, workspaceId: ws, deletedAt: null }).lean();
        if (!current)
            throw (0, errors_1.notFound)("That agent");
        if (current.version !== version)
            throw (0, errors_1.stale)((0, serialize_1.agentOut)(current));
        const flow = (0, serialize_1.agentOut)(current);
        const issues = (0, flow_tree_1.flowIssues)(flow, await this.data.knownFields(ws)).map((i) => i.message);
        if (!current.numberId)
            issues.unshift("Pick a phone number for it to call from and answer on.");
        if (issues.length)
            throw (0, errors_1.unprocessable)("Fix these before going live.", { issues });
        const last = await this.versions.findOne({ agentId: id }).sort({ n: -1 }).lean();
        const v = await this.versions.create({ workspaceId: ws, agentId: id, n: (last?.n ?? 0) + 1, config: current.draft, publishedBy: userId });
        return (0, serialize_1.agentOut)(await (0, versioned_1.saveVersioned)(this.agents, { _id: id, workspaceId: ws }, version, { $set: { status: "live", publishedVersionId: v._id } }, serialize_1.agentOut, "That agent"));
    }
    async unpublish(ws, id, version) {
        await this.refuseIfCalling(ws, id, "switch it to draft");
        return (0, serialize_1.agentOut)(await (0, versioned_1.saveVersioned)(this.agents, { _id: id, workspaceId: ws }, version, { $set: { status: "draft" } }, serialize_1.agentOut, "That agent"));
    }
    async versionsOf(ws, id) {
        const list = await this.versions.find({ workspaceId: ws, agentId: id }, { config: 0 }).sort({ n: -1 }).lean();
        return list.map((v) => ({ id: String(v._id), n: v.n, publishedAt: v.createdAt.toISOString() }));
    }
    /** A copy starts as a draft with no number (numbers belong to one agent). */
    async duplicate(ws, id) {
        const source = await this.agents.findOne({ _id: id, workspaceId: ws, deletedAt: null }).lean();
        if (!source)
            throw (0, errors_1.notFound)("That agent");
        const names = new Set((await this.agents.find({ workspaceId: ws, deletedAt: null }, { "draft.name": 1 }).lean()).map((a) => a.draft.name));
        const base = source.draft.name;
        let name = `${base} copy`;
        for (let n = 2; names.has(name); n++)
            name = `${base} copy ${n}`;
        const doc = await this.agents.create({ workspaceId: ws, draft: { ...source.draft, name }, numberId: null });
        return (0, serialize_1.agentOut)(doc.toObject());
    }
    /** Soft delete; the number is freed; past calls keep their history. */
    async remove(ws, id) {
        await this.refuseIfCalling(ws, id, "delete it");
        const res = await this.agents.updateOne({ _id: id, workspaceId: ws, deletedAt: null }, { $set: { deletedAt: new Date(), numberId: null, status: "draft" } });
        if (!res.matchedCount)
            throw (0, errors_1.notFound)("That agent");
        return { deleted: true };
    }
    // ---- helpers ----
    async freeNumber(ws, numberId, forAgent) {
        if (!mongoose_2.Types.ObjectId.isValid(numberId))
            throw (0, errors_1.notFound)("That number");
        const n = await this.numbers.findOne({ _id: new mongoose_2.Types.ObjectId(numberId), workspaceId: ws }).lean();
        if (!n)
            throw (0, errors_1.notFound)("That number");
        const owner = await this.agents.findOne({ numberId: n._id, deletedAt: null, ...(forAgent ? { _id: { $ne: forAgent } } : {}) }).lean();
        if (owner)
            throw await this.numberTaken(ws, numberId);
        return n._id;
    }
    async numberTaken(ws, numberId) {
        const owner = await this.agents.findOne({ workspaceId: ws, numberId: new mongoose_2.Types.ObjectId(numberId), deletedAt: null }).lean();
        const name = owner ? owner.draft.name : "another agent";
        return (0, errors_1.conflict)(`This number belongs to ${name}. A number can answer for one agent only. Get another number, or pick a free one.`, { ownerId: owner ? String(owner._id) : null });
    }
    async refuseIfCalling(ws, id, what) {
        const running = await this.campaigns.find({ workspaceId: ws, deletedAt: null, status: "running", "config.agentId": String(id) }).lean();
        if (running.length)
            throw (0, errors_1.conflict)(`It's calling in ${running.map((c) => `“${c.config.name}”`).join(", ")}. Pause that first, then ${what}.`);
    }
    async checkKnowledge(ws, ids) {
        if (!ids.length)
            return;
        const valid = ids.filter((x) => mongoose_2.Types.ObjectId.isValid(x)).map((x) => new mongoose_2.Types.ObjectId(x));
        const found = await this.knowledge.countDocuments({ _id: { $in: valid }, workspaceId: ws, deletedAt: null });
        if (found !== new Set(ids).size)
            throw (0, errors_1.unprocessable)("Some attached knowledge isn't in this workspace any more.");
    }
};
exports.AgentsService = AgentsService;
exports.AgentsService = AgentsService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, mongoose_1.InjectModel)("Agent")),
    __param(1, (0, mongoose_1.InjectModel)("AgentVersion")),
    __param(2, (0, mongoose_1.InjectModel)("PhoneNumber")),
    __param(3, (0, mongoose_1.InjectModel)("Campaign")),
    __param(4, (0, mongoose_1.InjectModel)("Knowledge")),
    __metadata("design:paramtypes", [Object, Object, Object, Object, Object, workspace_data_1.WorkspaceData])
], AgentsService);
//# sourceMappingURL=agents.service.js.map