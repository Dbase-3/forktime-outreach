"use strict";
// Integrations: iteration 1 only remembers that a tool is connected and to
// which account (real OAuth connections are Phase 6).
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
exports.IntegrationsController = void 0;
const common_1 = require("@nestjs/common");
const mongoose_1 = require("@nestjs/mongoose");
const integrations_1 = require("@outreach/core/integrations");
const zod_1 = require("zod");
const decorators_1 = require("../../common/decorators");
const errors_1 = require("../../common/errors");
const serialize_1 = require("../../common/serialize");
const zod_2 = require("../../common/zod");
let IntegrationsController = class IntegrationsController {
    integrations;
    constructor(integrations) {
        this.integrations = integrations;
    }
    async list(ctx) {
        return (await this.integrations.find({ workspaceId: ctx.workspaceId }).lean()).map(serialize_1.integrationOut);
    }
    async connect(ctx, provider, body) {
        if (!(0, integrations_1.integrationInfo)(provider))
            throw (0, errors_1.notFound)("That integration");
        const { account } = (0, zod_2.parse)(zod_1.z.object({ account: zod_1.z.string().max(200).default("") }), body ?? {});
        const doc = await this.integrations.findOneAndUpdate({ workspaceId: ctx.workspaceId, providerId: provider }, { $set: { connected: true, account } }, { upsert: true, new: true }).lean();
        return (0, serialize_1.integrationOut)(doc);
    }
    async disconnect(ctx, provider) {
        await this.integrations.deleteOne({ workspaceId: ctx.workspaceId, providerId: provider });
        return { disconnected: true };
    }
};
exports.IntegrationsController = IntegrationsController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, decorators_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], IntegrationsController.prototype, "list", null);
__decorate([
    (0, common_1.Put)(":provider"),
    (0, decorators_1.Roles)("owner", "admin"),
    __param(0, (0, decorators_1.Ctx)()),
    __param(1, (0, common_1.Param)("provider")),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], IntegrationsController.prototype, "connect", null);
__decorate([
    (0, common_1.Delete)(":provider"),
    (0, decorators_1.Roles)("owner", "admin"),
    __param(0, (0, decorators_1.Ctx)()),
    __param(1, (0, common_1.Param)("provider")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], IntegrationsController.prototype, "disconnect", null);
exports.IntegrationsController = IntegrationsController = __decorate([
    (0, common_1.Controller)("w/:ws/integrations"),
    __param(0, (0, mongoose_1.InjectModel)("Integration")),
    __metadata("design:paramtypes", [Object])
], IntegrationsController);
//# sourceMappingURL=integrations.controller.js.map