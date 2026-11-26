"use strict";
// Campaigns. Audiences are counted in the database (core rules → MongoDB,
// minus the do-not-call list and numbers that can't be dialled). Starting runs
// core campaignIssues on the server. While running, the agent, audience,
// timing and trigger are locked: pause first (roadmap §2.2).
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
exports.CampaignsController = void 0;
const common_1 = require("@nestjs/common");
const mongoose_1 = require("@nestjs/mongoose");
const campaign_1 = require("@outreach/core/campaign");
const phone_1 = require("@outreach/core/phone");
const schemas_1 = require("@outreach/core/schemas");
const zod_1 = require("zod");
const decorators_1 = require("../../common/decorators");
const errors_1 = require("../../common/errors");
const ids_1 = require("../../common/ids");
const serialize_1 = require("../../common/serialize");
const versioned_1 = require("../../common/versioned");
const workspace_data_1 = require("../../common/workspace-data");
const zod_2 = require("../../common/zod");
const contacts_service_1 = require("../contacts/contacts.service");
const V = zod_1.z.object({ version: zod_1.z.number().int() });
let CampaignsController = class CampaignsController {
    campaigns;
    contacts;
    people;
    data;
    constructor(campaigns, contacts, people, data) {
        this.campaigns = campaigns;
        this.contacts = contacts;
        this.people = people;
        this.data = data;
    }
    /** Who the campaign would call right now, and who it skips and why. */
    async audience(ws, c) {
        const settings = await this.data.settings(ws);
        const dnc = [...(0, phone_1.dncSet)(settings.doNotCall, (0, phone_1.countryOfZone)(settings.timezone))];
        const base = await this.people.filterFor(ws, { search: "", list: c.audience.list, filter: c.audience.filter });
        const [included, badPhone, doNotCall] = await Promise.all([
            this.contacts.countDocuments({ $and: [base, { phoneE164: { $type: "string", $nin: dnc } }] }),
            this.contacts.countDocuments({ $and: [base, { phoneE164: null }] }),
            dnc.length ? this.contacts.countDocuments({ $and: [base, { phoneE164: { $in: dnc } }] }) : 0,
        ]);
        return { count: included, skipped: { doNotCall, badPhone }, filter: { $and: [base, { phoneE164: { $type: "string", $nin: dnc } }] } };
    }
    async load(ws, id) {
        const c = await this.campaigns.findOne({ _id: (0, ids_1.oid)(id, "That campaign"), workspaceId: ws, deletedAt: null }).lean();
        if (!c)
            throw (0, errors_1.notFound)("That campaign");
        return c;
    }
    async issues(ws, c) {
        const [flows, defs, settings, aud] = await Promise.all([this.data.flows(ws), this.data.defs(ws), this.data.settings(ws), this.audience(ws, c)]);
        return (0, campaign_1.campaignIssues)(c, { flows, defs, audienceCount: aud.count, workspace: settings });
    }
    async list(ctx) {
        const rows = (await this.campaigns.find({ workspaceId: ctx.workspaceId, deletedAt: null }).sort({ createdAt: -1 }).lean()).map(serialize_1.campaignOut);
        return Promise.all(rows.map(async (c) => ({ ...c, audienceCount: (await this.audience(ctx.workspaceId, c)).count, firstIssue: (await this.issues(ctx.workspaceId, c))[0] ?? null })));
    }
    async create(ctx, body) {
        const { agentId, name } = (0, zod_2.parse)(zod_1.z.object({ agentId: zod_1.z.string().max(64), name: zod_1.z.string().max(120).optional() }), body ?? {});
        const { id: _i, status: _s, called: _c, answered: _a, createdAt: _t, ...config } = (0, campaign_1.defaultCampaign)(agentId);
        const doc = await this.campaigns.create({ workspaceId: ctx.workspaceId, config: { ...config, name: name || config.name } });
        return (0, serialize_1.campaignOut)(doc.toObject());
    }
    async get(ctx, id) {
        const c = (0, serialize_1.campaignOut)(await this.load(ctx.workspaceId, id));
        const aud = await this.audience(ctx.workspaceId, c);
        return { ...c, audienceCount: aud.count, skipped: aud.skipped, issues: await this.issues(ctx.workspaceId, c) };
    }
    async save(ctx, id, body) {
        const { version, ...patch } = (0, zod_2.parse)(V.merge(schemas_1.CampaignInputSchema.partial()), body);
        const current = await this.load(ctx.workspaceId, id);
        if (current.status === "running") {
            const locked = schemas_1.CAMPAIGN_LOCKED_WHILE_RUNNING.filter((k) => k in patch && JSON.stringify(patch[k]) !== JSON.stringify(current.config[k]));
            if (locked.length)
                throw (0, errors_1.conflict)("Pause the campaign to change who it calls, when, or with which agent.", { locked });
        }
        const config = (0, zod_2.parse)(schemas_1.CampaignInputSchema, { ...current.config, ...patch });
        return (0, serialize_1.campaignOut)(await (0, versioned_1.saveVersioned)(this.campaigns, { _id: current._id, workspaceId: ctx.workspaceId }, version, { $set: { config } }, serialize_1.campaignOut, "That campaign"));
    }
    async start(ctx, id, body) {
        const { version } = (0, zod_2.parse)(V, body);
        const current = await this.load(ctx.workspaceId, id);
        const issues = await this.issues(ctx.workspaceId, (0, serialize_1.campaignOut)(current));
        if (issues.length)
            throw (0, errors_1.unprocessable)("Fix these before starting.", { issues });
        return (0, serialize_1.campaignOut)(await (0, versioned_1.saveVersioned)(this.campaigns, { _id: current._id, workspaceId: ctx.workspaceId }, version, { $set: { status: "running" } }, serialize_1.campaignOut, "That campaign"));
    }
    async pause(ctx, id, body) {
        const { version } = (0, zod_2.parse)(V, body);
        const current = await this.load(ctx.workspaceId, id);
        return (0, serialize_1.campaignOut)(await (0, versioned_1.saveVersioned)(this.campaigns, { _id: current._id, workspaceId: ctx.workspaceId }, version, { $set: { status: "paused" } }, serialize_1.campaignOut, "That campaign"));
    }
    async remove(ctx, id) {
        const res = await this.campaigns.updateOne({ _id: (0, ids_1.oid)(id, "That campaign"), workspaceId: ctx.workspaceId, deletedAt: null }, { $set: { deletedAt: new Date(), status: "done" } });
        if (!res.matchedCount)
            throw (0, errors_1.notFound)("That campaign");
        return { deleted: true };
    }
    /** For "Keep calling around a date": who's due in the next N days, soonest first. */
    async upcoming(ctx, id) {
        const c = (0, serialize_1.campaignOut)(await this.load(ctx.workspaceId, id));
        if (c.mode !== "always" || c.trigger.kind !== "date_field")
            return { total: 0, next: [] };
        const aud = await this.audience(ctx.workspaceId, c);
        const today = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()).getTime();
        const horizon = today + 60 * 86_400_000;
        const due = [];
        for await (const row of this.people.cursor({ $and: [aud.filter, { [`fields.${c.trigger.field}`]: { $exists: true } }] })) {
            const contact = (0, contacts_service_1.contactOut)(row);
            const d = (0, campaign_1.dueDate)(c.trigger, contact);
            if (d && d.getTime() >= today && d.getTime() <= horizon)
                due.push({ contact, due: d.toISOString() });
        }
        due.sort((a, b) => a.due.localeCompare(b.due));
        return { total: due.length, next: due.slice(0, 10) };
    }
};
exports.CampaignsController = CampaignsController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, decorators_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], CampaignsController.prototype, "list", null);
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, decorators_1.Ctx)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], CampaignsController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(":id"),
    __param(0, (0, decorators_1.Ctx)()),
    __param(1, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], CampaignsController.prototype, "get", null);
__decorate([
    (0, common_1.Patch)(":id"),
    __param(0, (0, decorators_1.Ctx)()),
    __param(1, (0, common_1.Param)("id")),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], CampaignsController.prototype, "save", null);
__decorate([
    (0, common_1.Post)(":id/start"),
    __param(0, (0, decorators_1.Ctx)()),
    __param(1, (0, common_1.Param)("id")),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], CampaignsController.prototype, "start", null);
__decorate([
    (0, common_1.Post)(":id/pause"),
    __param(0, (0, decorators_1.Ctx)()),
    __param(1, (0, common_1.Param)("id")),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], CampaignsController.prototype, "pause", null);
__decorate([
    (0, common_1.Delete)(":id"),
    __param(0, (0, decorators_1.Ctx)()),
    __param(1, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], CampaignsController.prototype, "remove", null);
__decorate([
    (0, common_1.Get)(":id/upcoming"),
    __param(0, (0, decorators_1.Ctx)()),
    __param(1, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], CampaignsController.prototype, "upcoming", null);
exports.CampaignsController = CampaignsController = __decorate([
    (0, common_1.Controller)("w/:ws/campaigns"),
    __param(0, (0, mongoose_1.InjectModel)("Campaign")),
    __param(1, (0, mongoose_1.InjectModel)("Contact")),
    __metadata("design:paramtypes", [Object, Object, contacts_service_1.ContactsService,
        workspace_data_1.WorkspaceData])
], CampaignsController);
//# sourceMappingURL=campaigns.controller.js.map