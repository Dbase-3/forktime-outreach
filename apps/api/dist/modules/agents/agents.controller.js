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
exports.AgentsController = void 0;
const common_1 = require("@nestjs/common");
const schemas_1 = require("@outreach/core/schemas");
const zod_1 = require("zod");
const decorators_1 = require("../../common/decorators");
const ids_1 = require("../../common/ids");
const zod_2 = require("../../common/zod");
const agents_service_1 = require("./agents.service");
const V = zod_1.z.object({ version: zod_1.z.number().int() });
let AgentsController = class AgentsController {
    service;
    constructor(service) {
        this.service = service;
    }
    list(ctx) {
        return this.service.list(ctx.workspaceId);
    }
    create(ctx, body) {
        return this.service.create(ctx.workspaceId, (0, zod_2.parse)(zod_1.z.object({ templateId: zod_1.z.string().max(64).nullable().optional(), name: zod_1.z.string().max(80).default(""), numberId: zod_1.z.string().max(64).nullable().optional() }), body));
    }
    get(ctx, id) {
        return this.service.get(ctx.workspaceId, (0, ids_1.oid)(id, "That agent"));
    }
    save(ctx, id, body) {
        const { version, draft } = (0, zod_2.parse)(V.extend({ draft: schemas_1.AgentDraftSchema.partial() }), body);
        return this.service.saveDraft(ctx.workspaceId, (0, ids_1.oid)(id, "That agent"), version, draft);
    }
    number(ctx, id, body) {
        const { version, numberId } = (0, zod_2.parse)(V.extend({ numberId: zod_1.z.string().max(64).nullable() }), body);
        return this.service.setNumber(ctx.workspaceId, (0, ids_1.oid)(id, "That agent"), version, numberId);
    }
    publish(ctx, id, body) {
        return this.service.publish(ctx.workspaceId, (0, ids_1.oid)(id, "That agent"), (0, zod_2.parse)(V, body).version, ctx.userId);
    }
    unpublish(ctx, id, body) {
        return this.service.unpublish(ctx.workspaceId, (0, ids_1.oid)(id, "That agent"), (0, zod_2.parse)(V, body).version);
    }
    versions(ctx, id) {
        return this.service.versionsOf(ctx.workspaceId, (0, ids_1.oid)(id, "That agent"));
    }
    duplicate(ctx, id) {
        return this.service.duplicate(ctx.workspaceId, (0, ids_1.oid)(id, "That agent"));
    }
    remove(ctx, id) {
        return this.service.remove(ctx.workspaceId, (0, ids_1.oid)(id, "That agent"));
    }
};
exports.AgentsController = AgentsController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, decorators_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], AgentsController.prototype, "list", null);
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, decorators_1.Ctx)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], AgentsController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(":id"),
    __param(0, (0, decorators_1.Ctx)()),
    __param(1, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], AgentsController.prototype, "get", null);
__decorate([
    (0, common_1.Patch)(":id"),
    __param(0, (0, decorators_1.Ctx)()),
    __param(1, (0, common_1.Param)("id")),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], AgentsController.prototype, "save", null);
__decorate([
    (0, common_1.Put)(":id/number"),
    __param(0, (0, decorators_1.Ctx)()),
    __param(1, (0, common_1.Param)("id")),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], AgentsController.prototype, "number", null);
__decorate([
    (0, common_1.Post)(":id/publish"),
    __param(0, (0, decorators_1.Ctx)()),
    __param(1, (0, common_1.Param)("id")),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], AgentsController.prototype, "publish", null);
__decorate([
    (0, common_1.Post)(":id/unpublish"),
    __param(0, (0, decorators_1.Ctx)()),
    __param(1, (0, common_1.Param)("id")),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], AgentsController.prototype, "unpublish", null);
__decorate([
    (0, common_1.Get)(":id/versions"),
    __param(0, (0, decorators_1.Ctx)()),
    __param(1, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], AgentsController.prototype, "versions", null);
__decorate([
    (0, common_1.Post)(":id/duplicate"),
    __param(0, (0, decorators_1.Ctx)()),
    __param(1, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], AgentsController.prototype, "duplicate", null);
__decorate([
    (0, common_1.Delete)(":id"),
    __param(0, (0, decorators_1.Ctx)()),
    __param(1, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], AgentsController.prototype, "remove", null);
exports.AgentsController = AgentsController = __decorate([
    (0, common_1.Controller)("w/:ws/agents"),
    __metadata("design:paramtypes", [agents_service_1.AgentsService])
], AgentsController);
//# sourceMappingURL=agents.controller.js.map