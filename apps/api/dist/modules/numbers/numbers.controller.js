"use strict";
// Phone numbers. Iteration 1 uses a fake provider: the numbers offered come
// from fictional ranges (@outreach/core numbers.ts) and "buying" one just
// records it. Phase 3 swaps in Telnyx behind the same endpoints.
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
exports.NumbersController = void 0;
const common_1 = require("@nestjs/common");
const mongoose_1 = require("@nestjs/mongoose");
const numbers_1 = require("@outreach/core/numbers");
const zod_1 = require("zod");
const decorators_1 = require("../../common/decorators");
const errors_1 = require("../../common/errors");
const ids_1 = require("../../common/ids");
const serialize_1 = require("../../common/serialize");
const zod_2 = require("../../common/zod");
const Search = zod_1.z.object({ country: zod_1.z.enum(numbers_1.COUNTRIES.map((c) => c.code)), kind: zod_1.z.enum(["local", "mobile", "tollfree"]), area: zod_1.z.string().max(8).default("") });
let NumbersController = class NumbersController {
    numbers;
    agents;
    constructor(numbers, agents) {
        this.numbers = numbers;
        this.agents = agents;
    }
    async list(ctx) {
        return (await this.numbers.find({ workspaceId: ctx.workspaceId }).sort({ createdAt: 1 }).lean()).map(serialize_1.numberOut);
    }
    /** Candidates first, then only those are checked against the database (no full scan). */
    async offers(country, kind, area, count) {
        const candidates = (0, numbers_1.availableNumbers)(country, kind, area, [], 40);
        const taken = new Set((await this.numbers.find({ e164: { $in: candidates.map((c) => c.e164) } }, { e164: 1 }).lean()).map((n) => n.e164));
        return candidates.filter((c) => !taken.has(c.e164)).slice(0, count);
    }
    async search(body) {
        const q = (0, zod_2.parse)(Search, body);
        return this.offers(q.country, q.kind, q.area, 5);
    }
    async add(ctx, body) {
        const q = (0, zod_2.parse)(Search.extend({ e164: zod_1.z.string().max(20) }), body);
        const offer = (await this.offers(q.country, q.kind, q.area, 40)).find((o) => o.e164 === q.e164);
        if (!offer)
            throw (0, errors_1.unprocessable)("That number isn't available any more. Search again.");
        const doc = await this.numbers.create({ workspaceId: ctx.workspaceId, e164: offer.e164, display: offer.display, country: offer.country, kind: offer.kind, area: offer.area, provider: "fake" });
        return (0, serialize_1.numberOut)(doc.toObject());
    }
    async release(ctx, id) {
        const _id = (0, ids_1.oid)(id, "That number");
        const user = await this.agents.findOne({ workspaceId: ctx.workspaceId, numberId: _id, deletedAt: null }).lean();
        if (user)
            throw (0, errors_1.conflict)(`${user.draft.name} uses this number. Give it another number first.`);
        const res = await this.numbers.deleteOne({ _id, workspaceId: ctx.workspaceId });
        if (!res.deletedCount)
            throw (0, errors_1.notFound)("That number");
        return { released: true };
    }
};
exports.NumbersController = NumbersController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, decorators_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], NumbersController.prototype, "list", null);
__decorate([
    (0, common_1.Post)("search"),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], NumbersController.prototype, "search", null);
__decorate([
    (0, common_1.Post)(),
    (0, decorators_1.Roles)("owner", "admin"),
    __param(0, (0, decorators_1.Ctx)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], NumbersController.prototype, "add", null);
__decorate([
    (0, common_1.Delete)(":id"),
    (0, decorators_1.Roles)("owner", "admin"),
    __param(0, (0, decorators_1.Ctx)()),
    __param(1, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], NumbersController.prototype, "release", null);
exports.NumbersController = NumbersController = __decorate([
    (0, common_1.Controller)("w/:ws/numbers"),
    __param(0, (0, mongoose_1.InjectModel)("PhoneNumber")),
    __param(1, (0, mongoose_1.InjectModel)("Agent")),
    __metadata("design:paramtypes", [Object, Object])
], NumbersController);
//# sourceMappingURL=numbers.controller.js.map