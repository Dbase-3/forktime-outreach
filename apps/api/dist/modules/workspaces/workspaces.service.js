"use strict";
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
exports.WorkspacesService = void 0;
const common_1 = require("@nestjs/common");
const mongoose_1 = require("@nestjs/mongoose");
const mongoose_2 = require("mongoose");
const errors_1 = require("../../common/errors");
const serialize_1 = require("../../common/serialize");
const mailer_1 = require("../auth/mailer");
const sample_service_1 = require("./sample.service");
let WorkspacesService = class WorkspacesService {
    workspaces;
    memberships;
    invites;
    users;
    agents;
    numbers;
    knowledge;
    fields;
    sources;
    campaigns;
    integrations;
    contacts;
    calls;
    sample;
    mailer;
    constructor(workspaces, memberships, invites, users, agents, numbers, knowledge, fields, sources, campaigns, integrations, contacts, calls, sample, mailer) {
        this.workspaces = workspaces;
        this.memberships = memberships;
        this.invites = invites;
        this.users = users;
        this.agents = agents;
        this.numbers = numbers;
        this.knowledge = knowledge;
        this.fields = fields;
        this.sources = sources;
        this.campaigns = campaigns;
        this.integrations = integrations;
        this.contacts = contacts;
        this.calls = calls;
        this.sample = sample;
        this.mailer = mailer;
    }
    async create(userId, input) {
        const _id = new mongoose_2.Types.ObjectId();
        let settings = { businessName: input.name, timezone: input.timezone };
        await this.workspaces.create({ _id, name: input.name, settings, createdBy: userId });
        await this.memberships.create({ workspaceId: _id, userId, role: "owner" });
        if (input.sample) {
            const filled = await this.sample.fill(_id);
            settings = { ...filled.settings, businessName: input.name || filled.settings.businessName };
            await this.workspaces.updateOne({ _id }, { $set: { settings: { businessName: settings.businessName, timezone: settings.timezone, callingDays: settings.callingDays, callingStart: settings.callingStart, callingEnd: settings.callingEnd, doNotCall: settings.doNotCall } } });
        }
        return { id: String(_id) };
    }
    async get(ws, role) {
        const w = await this.workspaces.findById(ws).lean();
        if (!w)
            throw (0, errors_1.notFound)("That workspace");
        return { id: String(w._id), name: w.name, role, settings: w.settings, version: w.version };
    }
    async saveSettings(ws, version, settings) {
        const w = await this.workspaces.findOneAndUpdate({ _id: ws, version }, { $set: { settings, name: settings.businessName }, $inc: { version: 1 } }, { new: true }).lean();
        if (w)
            return { settings: w.settings, version: w.version };
        const current = await this.workspaces.findById(ws).lean();
        if (!current)
            throw (0, errors_1.notFound)("That workspace");
        throw (0, errors_1.stale)({ settings: current.settings, version: current.version });
    }
    /** Everything the screens need up front. Contacts and calls are paged separately. */
    async bootstrap(ws, role) {
        const live = { workspaceId: ws, deletedAt: null };
        const [workspace, agents, numbers, knowledge, fields, sources, campaigns, integrations, contactCount, callCount] = await Promise.all([
            this.get(ws, role),
            this.agents.find(live).sort({ updatedAt: -1 }).lean(),
            this.numbers.find({ workspaceId: ws }).sort({ createdAt: 1 }).lean(),
            this.knowledge.find(live, { content: 0 }).sort({ updatedAt: -1 }).lean(),
            this.fields.find({ workspaceId: ws }).sort({ createdAt: 1 }).lean(),
            this.sources.find({ workspaceId: ws }).lean(),
            this.campaigns.find(live).sort({ createdAt: -1 }).lean(),
            this.integrations.find({ workspaceId: ws }).lean(),
            this.contacts.countDocuments(live),
            this.calls.countDocuments({ workspaceId: ws }),
        ]);
        return {
            workspace,
            flows: agents.map(serialize_1.agentOut),
            numbers: numbers.map(serialize_1.numberOut),
            knowledge: knowledge.map((k) => (0, serialize_1.knowledgeOut)(k)),
            fieldDefs: fields.map(serialize_1.fieldOut),
            sources: sources.map(serialize_1.sourceOut),
            campaigns: campaigns.map(serialize_1.campaignOut),
            integrations: integrations.map(serialize_1.integrationOut),
            counts: { contacts: contactCount, calls: callCount },
        };
    }
    async members(ws) {
        const [ms, open] = await Promise.all([this.memberships.find({ workspaceId: ws }).lean(), this.invites.find({ workspaceId: ws, acceptedAt: null }).lean()]);
        const people = await this.users.find({ _id: { $in: ms.map((m) => m.userId) } }).lean();
        return {
            members: ms.map((m) => ({ userId: String(m.userId), email: people.find((p) => String(p._id) === String(m.userId))?.email ?? "", role: m.role })),
            invites: open.map((i) => ({ id: String(i._id), email: i.email, role: i.role })),
        };
    }
    async invite(ws, byUser, byEmail, email, role, byRole) {
        if (role === "owner" && byRole !== "owner")
            throw (0, errors_1.forbidden)("Only owners can invite owners.");
        const w = await this.workspaces.findById(ws).lean();
        const existing = await this.users.findOne({ email }).lean();
        if (existing) {
            const res = await this.memberships.updateOne({ workspaceId: ws, userId: existing._id }, { $setOnInsert: { role } }, { upsert: true });
            if (!res.upsertedCount)
                throw (0, errors_1.conflict)(`${email} is already a member.`);
        }
        else {
            await this.invites.updateOne({ workspaceId: ws, email }, { $set: { role, invitedBy: byUser, acceptedAt: null } }, { upsert: true });
        }
        await this.mailer.sendInvite(email, w?.name ?? "a workspace", byEmail);
        return this.members(ws);
    }
    async setRole(ws, userId, role) {
        if (role !== "owner")
            await this.keepAnOwner(ws, userId);
        const res = await this.memberships.updateOne({ workspaceId: ws, userId }, { $set: { role } });
        if (!res.matchedCount)
            throw (0, errors_1.notFound)("That member");
        return this.members(ws);
    }
    async remove(ws, userId) {
        await this.keepAnOwner(ws, userId);
        await this.memberships.deleteOne({ workspaceId: ws, userId });
        return this.members(ws);
    }
    async cancelInvite(ws, inviteId) {
        await this.invites.deleteOne({ workspaceId: ws, _id: inviteId });
        return this.members(ws);
    }
    /** A workspace always keeps at least one owner. */
    async keepAnOwner(ws, userId) {
        const owners = await this.memberships.find({ workspaceId: ws, role: "owner" }).lean();
        if (owners.length === 1 && String(owners[0].userId) === String(userId))
            throw (0, errors_1.conflict)("A workspace needs at least one owner. Make someone else an owner first.");
    }
};
exports.WorkspacesService = WorkspacesService;
exports.WorkspacesService = WorkspacesService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, mongoose_1.InjectModel)("Workspace")),
    __param(1, (0, mongoose_1.InjectModel)("Membership")),
    __param(2, (0, mongoose_1.InjectModel)("Invite")),
    __param(3, (0, mongoose_1.InjectModel)("User")),
    __param(4, (0, mongoose_1.InjectModel)("Agent")),
    __param(5, (0, mongoose_1.InjectModel)("PhoneNumber")),
    __param(6, (0, mongoose_1.InjectModel)("Knowledge")),
    __param(7, (0, mongoose_1.InjectModel)("FieldDef")),
    __param(8, (0, mongoose_1.InjectModel)("Source")),
    __param(9, (0, mongoose_1.InjectModel)("Campaign")),
    __param(10, (0, mongoose_1.InjectModel)("Integration")),
    __param(11, (0, mongoose_1.InjectModel)("Contact")),
    __param(12, (0, mongoose_1.InjectModel)("Call")),
    __metadata("design:paramtypes", [Object, Object, Object, Object, Object, Object, Object, Object, Object, Object, Object, Object, Object, sample_service_1.SampleService,
        mailer_1.Mailer])
], WorkspacesService);
//# sourceMappingURL=workspaces.service.js.map