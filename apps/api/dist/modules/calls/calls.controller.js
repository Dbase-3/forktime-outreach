"use strict";
// Calls: a paged list (no transcripts), one call in full, feedback. Search
// covers the summary and the caller's name or number.
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
exports.CallsController = exports.LIGHT = void 0;
const common_1 = require("@nestjs/common");
const mongoose_1 = require("@nestjs/mongoose");
const mongoose_2 = require("mongoose");
const zod_1 = require("zod");
const decorators_1 = require("../../common/decorators");
const errors_1 = require("../../common/errors");
const ids_1 = require("../../common/ids");
const serialize_1 = require("../../common/serialize");
const zod_2 = require("../../common/zod");
const contacts_service_1 = require("../contacts/contacts.service");
const Query = zod_1.z.object({
    search: zod_1.z.string().max(120).default(""),
    direction: zod_1.z.enum(["all", "inbound", "outbound"]).default("all"),
    agentId: zod_1.z.string().max(64).default(""),
    outcome: zod_1.z.string().max(64).default(""),
    action: zod_1.z.string().max(40).default(""),
    page: zod_1.z.number().int().min(1).max(10000).default(1),
    pageSize: zod_1.z.number().int().min(1).max(100).default(50),
});
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
exports.LIGHT = { transcript: 0 };
let CallsController = class CallsController {
    calls;
    contacts;
    constructor(calls, contacts) {
        this.calls = calls;
        this.contacts = contacts;
    }
    /** Calls with their contacts' names, newest first, live ones on top. */
    async query(ctx, body) {
        const ws = ctx.workspaceId;
        const q = (0, zod_2.parse)(Query, body ?? {});
        const and = [{ workspaceId: ws }];
        if (q.direction !== "all")
            and.push({ direction: q.direction });
        if (q.agentId && mongoose_2.Types.ObjectId.isValid(q.agentId))
            and.push({ agentId: new mongoose_2.Types.ObjectId(q.agentId) });
        if (q.outcome)
            and.push({ outcome: q.outcome });
        if (q.action)
            and.push({ actions: q.action });
        if (q.search.trim()) {
            const re = new RegExp(esc(q.search.trim()), "i");
            const people = await this.contacts.find({ workspaceId: ws, $or: [{ name: re }, { phone: re }] }, { _id: 1 }).limit(2000).lean();
            and.push({ $or: [{ summary: re }, { contactId: { $in: people.map((p) => p._id) } }] });
        }
        const filter = { $and: and };
        const [total, rows] = await Promise.all([this.calls.countDocuments(filter), this.calls.find(filter, exports.LIGHT).sort({ live: -1, startedAt: -1 }).skip((q.page - 1) * q.pageSize).limit(q.pageSize).lean()]);
        return { rows: rows.map(serialize_1.callOut), contacts: await this.contactsFor(ws, rows), total, page: q.page, pages: Math.max(1, Math.ceil(total / q.pageSize)) };
    }
    async outcomes(ctx) {
        return (await this.calls.distinct("outcome", { workspaceId: ctx.workspaceId })).filter(Boolean).sort();
    }
    async get(ctx, id) {
        const c = await this.calls.findOne({ _id: (0, ids_1.oid)(id, "That call"), workspaceId: ctx.workspaceId }).lean();
        if (!c)
            throw (0, errors_1.notFound)("That call");
        const contact = c.contactId ? await this.contacts.findOne({ _id: c.contactId, workspaceId: ctx.workspaceId }).lean() : null;
        return { call: (0, serialize_1.callOut)(c), contact: contact ? (0, contacts_service_1.contactOut)(contact) : null };
    }
    async feedback(ctx, id, body) {
        const { feedback } = (0, zod_2.parse)(zod_1.z.object({ feedback: zod_1.z.object({ rating: zod_1.z.enum(["up", "down"]), reasons: zod_1.z.array(zod_1.z.enum(["misunderstood", "wrong_info", "booking_mistake", "talked_over", "should_transfer", "robotic", "other"])).max(7), note: zod_1.z.string().max(2000), at: zod_1.z.string().max(40) }).nullable() }), body);
        const c = await this.calls.findOneAndUpdate({ _id: (0, ids_1.oid)(id, "That call"), workspaceId: ctx.workspaceId }, { $set: { feedback } }, { new: true, projection: exports.LIGHT }).lean();
        if (!c)
            throw (0, errors_1.notFound)("That call");
        return (0, serialize_1.callOut)(c);
    }
    async contactsFor(ws, rows) {
        const ids = [...new Set(rows.flatMap((r) => (r.contactId ? [String(r.contactId)] : [])))].map((x) => new mongoose_2.Types.ObjectId(x));
        const people = await this.contacts.find({ _id: { $in: ids }, workspaceId: ws }).lean();
        return Object.fromEntries(people.map((p) => [String(p._id), { id: String(p._id), name: p.name, phone: p.phone }]));
    }
};
exports.CallsController = CallsController;
__decorate([
    (0, common_1.Post)("query"),
    __param(0, (0, decorators_1.Ctx)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], CallsController.prototype, "query", null);
__decorate([
    (0, common_1.Get)("outcomes"),
    __param(0, (0, decorators_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], CallsController.prototype, "outcomes", null);
__decorate([
    (0, common_1.Get)(":id"),
    __param(0, (0, decorators_1.Ctx)()),
    __param(1, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], CallsController.prototype, "get", null);
__decorate([
    (0, common_1.Patch)(":id/feedback"),
    __param(0, (0, decorators_1.Ctx)()),
    __param(1, (0, common_1.Param)("id")),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], CallsController.prototype, "feedback", null);
exports.CallsController = CallsController = __decorate([
    (0, common_1.Controller)("w/:ws/calls"),
    __param(0, (0, mongoose_1.InjectModel)("Call")),
    __param(1, (0, mongoose_1.InjectModel)("Contact")),
    __metadata("design:paramtypes", [Object, Object])
], CallsController);
//# sourceMappingURL=calls.controller.js.map