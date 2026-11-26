"use strict";
// Analytics and Home figures, worked out on the server with the same core
// functions the prototype used in the browser, over this workspace's calls
// without transcripts. Phase 5 replaces this with daily roll-ups.
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
exports.AnalyticsController = void 0;
const common_1 = require("@nestjs/common");
const mongoose_1 = require("@nestjs/mongoose");
const analytics_1 = require("@outreach/core/analytics");
const campaign_1 = require("@outreach/core/campaign");
const stats_1 = require("@outreach/core/stats");
const mongoose_2 = require("mongoose");
const zod_1 = require("zod");
const decorators_1 = require("../../common/decorators");
const serialize_1 = require("../../common/serialize");
const workspace_data_1 = require("../../common/workspace-data");
const zod_2 = require("../../common/zod");
const contacts_service_1 = require("../contacts/contacts.service");
const calls_controller_1 = require("../calls/calls.controller");
const DAY = 86_400_000;
let AnalyticsController = class AnalyticsController {
    calls;
    contacts;
    data;
    constructor(calls, contacts, data) {
        this.calls = calls;
        this.contacts = contacts;
        this.data = data;
    }
    async callsSince(ws, from) {
        return (await this.calls.find({ workspaceId: ws, $or: [{ startedAt: { $gte: from } }, { live: true }] }, calls_controller_1.LIGHT).lean()).map(serialize_1.callOut);
    }
    async analytics(ctx, body) {
        const ws = ctx.workspaceId;
        const q = (0, zod_2.parse)(zod_1.z.object({ range: zod_1.z.enum(analytics_1.RANGES.map((r) => r.id)).default("30d"), agentId: zod_1.z.string().max(64).default(""), direction: zod_1.z.enum(["all", "inbound", "outbound"]).default("all"), language: zod_1.z.string().max(40).default(""), metric: zod_1.z.enum(["pickup", "goal"]).default("pickup") }), body ?? {});
        const now = new Date();
        const b = (0, analytics_1.rangeBounds)(q.range, now);
        const [all, flows, settings] = await Promise.all([this.callsSince(ws, new Date(b.prevFrom)), this.data.flows(ws), this.data.settings(ws)]);
        const filter = { flowId: q.agentId || undefined, direction: q.direction === "all" ? undefined : q.direction, language: q.language || undefined };
        const calls = (0, analytics_1.pickCalls)(all, flows, b.from, b.to, filter);
        const before = (0, analytics_1.pickCalls)(all, flows, b.prevFrom, b.prevTo, filter);
        const ids = [...new Set(calls.flatMap((c) => (c.contactId ? [c.contactId] : [])))].filter((x) => mongoose_2.Types.ObjectId.isValid(x)).map((x) => new mongoose_2.Types.ObjectId(x));
        const people = (await this.contacts.find({ _id: { $in: ids }, workspaceId: ws }, { phone: 1, name: 1 }).lean()).map((p) => ({ id: String(p._id), phone: p.phone, name: p.name }));
        return {
            bounds: b,
            now: { summary: (0, analytics_1.summarize)(calls), conversation: (0, analytics_1.conversation)(calls) },
            was: { summary: (0, analytics_1.summarize)(before), conversation: (0, analytics_1.conversation)(before) },
            buckets: (0, analytics_1.timeline)(calls, b.from, b.to),
            pickup: (0, analytics_1.pickupBreakdown)(calls),
            byAgent: (0, analytics_1.byAgent)(calls, flows, b.from, b.to).map((r) => ({ flowId: r.flow.id, summary: r.summary, trend: r.trend })),
            outcomes: (0, analytics_1.topOutcomes)(calls),
            directions: (0, analytics_1.directions)(calls),
            transfers: (0, analytics_1.transfers)(calls),
            bestTimes: (0, analytics_1.bestTimes)(calls, people, settings.timezone, q.metric),
            languages: [...new Set(flows.map((f) => f.agent.language))].sort(),
        };
    }
    /** Everything Home shows, in one request. */
    async home(ctx) {
        const ws = ctx.workspaceId;
        const now = new Date();
        const [calls, flows, settings, campaigns] = await Promise.all([this.callsSince(ws, new Date(now.getTime() - 15 * DAY)), this.data.flows(ws), this.data.settings(ws), this.data.campaignsOf(ws)]);
        const done = calls.filter((c) => !c.live);
        const window = (days) => {
            const since = now.getTime() - days * DAY;
            const inRange = done.filter((c) => new Date(c.startedAt).getTime() >= since);
            const talked = inRange.filter(stats_1.answered);
            const counts = new Map();
            inRange.forEach((c) => counts.set(c.outcome, (counts.get(c.outcome) ?? 0) + 1));
            return {
                perDay: (0, stats_1.callsPerDay)(calls, days, now).map((p) => ({ day: p.day.toISOString(), calls: p.calls, wins: p.wins })),
                calls: inRange.length,
                wins: inRange.filter((c) => (0, stats_1.isWin)(c.outcome)).length,
                answered: talked.length,
                talkSec: talked.reduce((s, c) => s + c.durationSec, 0),
                outcomes: [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([outcome, count]) => ({ outcome, count })),
            };
        };
        const lastCallAt = async (flowId) => (await this.calls.findOne({ workspaceId: ws, agentId: new mongoose_2.Types.ObjectId(flowId), live: { $ne: true } }, { startedAt: 1 }).sort({ startedAt: -1 }).lean())?.startedAt?.toISOString() ?? null;
        const agents = Object.fromEntries(await Promise.all(flows.map(async (f) => {
            const stats = (0, stats_1.agentStats)(f, calls, now);
            return [f.id, { stats: { ...stats, lastCallAt: stats.lastCallAt ?? (await lastCallAt(f.id)) }, trend: (0, stats_1.callsPerDay)(calls.filter((c) => c.flowId === f.id), 14, now).map((p) => p.calls), liveCallId: calls.find((c) => c.live && c.flowId === f.id)?.id ?? null }];
        })));
        const recentRows = await this.calls.find({ workspaceId: ws }, calls_controller_1.LIGHT).sort({ startedAt: -1 }).limit(5).lean();
        const recent = recentRows.map(serialize_1.callOut);
        const recentPeople = await this.contacts.find({ _id: { $in: recentRows.flatMap((r) => (r.contactId ? [r.contactId] : [])) } }, { name: 1, phone: 1 }).lean();
        // Who's due next in campaigns that call around a date (next 30 days).
        const rules = (0, campaign_1.callRulesFor)(settings);
        const dated = campaigns.filter((c) => c.status === "running" && c.mode === "always" && c.trigger.kind === "date_field");
        const upcoming = [];
        for (const c of dated) {
            if (c.trigger.kind !== "date_field")
                continue;
            const rows = (await this.contacts.find({ workspaceId: ws, deletedAt: null, [`fields.${c.trigger.field}`]: { $exists: true } }).limit(5000).lean()).map(contacts_service_1.contactOut);
            for (const p of (0, campaign_1.upcomingCalls)(c, (0, campaign_1.audienceOf)(c, rows, now, rules), now, 30, rules))
                upcoming.push({ contact: { id: p.contact.id, name: p.contact.name }, due: p.due.toISOString(), campaignId: c.id, campaignName: c.name });
        }
        upcoming.sort((a, b) => a.due.localeCompare(b.due));
        return {
            liveNow: calls.filter((c) => c.live).length,
            today: (0, stats_1.callsPerDay)(calls, 1, now)[0].calls,
            agents,
            windows: { 7: window(7), 14: window(14) },
            recent: recent.map((c) => ({ call: c, contact: recentPeople.find((p) => String(p._id) === c.contactId) ? { id: c.contactId, name: recentPeople.find((p) => String(p._id) === c.contactId).name } : null })),
            upcoming: upcoming.slice(0, 5),
        };
    }
};
exports.AnalyticsController = AnalyticsController;
__decorate([
    (0, common_1.Post)("analytics"),
    __param(0, (0, decorators_1.Ctx)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AnalyticsController.prototype, "analytics", null);
__decorate([
    (0, common_1.Get)("home"),
    __param(0, (0, decorators_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AnalyticsController.prototype, "home", null);
exports.AnalyticsController = AnalyticsController = __decorate([
    (0, common_1.Controller)("w/:ws"),
    __param(0, (0, mongoose_1.InjectModel)("Call")),
    __param(1, (0, mongoose_1.InjectModel)("Contact")),
    __metadata("design:paramtypes", [Object, Object, workspace_data_1.WorkspaceData])
], AnalyticsController);
//# sourceMappingURL=analytics.controller.js.map