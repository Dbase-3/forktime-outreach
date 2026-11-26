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
exports.WorkspacesController = void 0;
const common_1 = require("@nestjs/common");
const schemas_1 = require("@outreach/core/schemas");
const zod_1 = require("zod");
const decorators_1 = require("../../common/decorators");
const ids_1 = require("../../common/ids");
const zod_2 = require("../../common/zod");
const schemas_2 = require("../../db/schemas");
const guards_1 = require("../../common/guards");
const workspaces_service_1 = require("./workspaces.service");
const CreateSchema = zod_1.z.object({ name: zod_1.z.string().trim().min(1).max(120), timezone: zod_1.z.string().max(64).default("Australia/Sydney"), sample: zod_1.z.boolean().default(false) });
let WorkspacesController = class WorkspacesController {
    service;
    guard;
    constructor(service, guard) {
        this.service = service;
        this.guard = guard;
    }
    create(ctx, body) {
        return this.service.create(ctx.userId, (0, zod_2.parse)(CreateSchema, body));
    }
    get(ctx) {
        return this.service.get(ctx.workspaceId, ctx.role);
    }
    bootstrap(ctx) {
        return this.service.bootstrap(ctx.workspaceId, ctx.role);
    }
    settings(ctx, body) {
        const { version, settings } = (0, zod_2.parse)(zod_1.z.object({ version: zod_1.z.number().int(), settings: schemas_1.SettingsSchema }), body);
        return this.service.saveSettings(ctx.workspaceId, version, settings);
    }
    members(ctx) {
        return this.service.members(ctx.workspaceId);
    }
    invite(ctx, body) {
        const { email, role } = (0, zod_2.parse)(zod_1.z.object({ email: schemas_1.EmailSchema, role: zod_1.z.enum(schemas_2.ROLES).default("member") }), body);
        return this.service.invite(ctx.workspaceId, ctx.userId, ctx.email, email, role, ctx.role);
    }
    cancelInvite(ctx, inviteId) {
        return this.service.cancelInvite(ctx.workspaceId, (0, ids_1.oid)(inviteId, "That invite"));
    }
    async role(ctx, userId, body) {
        const { role } = (0, zod_2.parse)(zod_1.z.object({ role: zod_1.z.enum(schemas_2.ROLES) }), body);
        const out = await this.service.setRole(ctx.workspaceId, (0, ids_1.oid)(userId, "That member"), role);
        this.guard.forget(String(ctx.workspaceId));
        return out;
    }
    async remove(ctx, userId) {
        const out = await this.service.remove(ctx.workspaceId, (0, ids_1.oid)(userId, "That member"));
        this.guard.forget(String(ctx.workspaceId));
        return out;
    }
};
exports.WorkspacesController = WorkspacesController;
__decorate([
    (0, common_1.Post)("workspaces"),
    __param(0, (0, decorators_1.Ctx)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], WorkspacesController.prototype, "create", null);
__decorate([
    (0, common_1.Get)("w/:ws"),
    __param(0, (0, decorators_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], WorkspacesController.prototype, "get", null);
__decorate([
    (0, common_1.Get)("w/:ws/bootstrap"),
    __param(0, (0, decorators_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], WorkspacesController.prototype, "bootstrap", null);
__decorate([
    (0, common_1.Patch)("w/:ws/settings"),
    (0, decorators_1.Roles)("owner", "admin"),
    __param(0, (0, decorators_1.Ctx)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], WorkspacesController.prototype, "settings", null);
__decorate([
    (0, common_1.Get)("w/:ws/members"),
    __param(0, (0, decorators_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], WorkspacesController.prototype, "members", null);
__decorate([
    (0, common_1.Post)("w/:ws/invites"),
    (0, decorators_1.Roles)("owner", "admin"),
    __param(0, (0, decorators_1.Ctx)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], WorkspacesController.prototype, "invite", null);
__decorate([
    (0, common_1.Delete)("w/:ws/invites/:inviteId"),
    (0, decorators_1.Roles)("owner", "admin"),
    __param(0, (0, decorators_1.Ctx)()),
    __param(1, (0, common_1.Param)("inviteId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], WorkspacesController.prototype, "cancelInvite", null);
__decorate([
    (0, common_1.Patch)("w/:ws/members/:userId"),
    (0, decorators_1.Roles)("owner"),
    __param(0, (0, decorators_1.Ctx)()),
    __param(1, (0, common_1.Param)("userId")),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], WorkspacesController.prototype, "role", null);
__decorate([
    (0, common_1.Delete)("w/:ws/members/:userId"),
    (0, decorators_1.Roles)("owner", "admin"),
    __param(0, (0, decorators_1.Ctx)()),
    __param(1, (0, common_1.Param)("userId")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], WorkspacesController.prototype, "remove", null);
exports.WorkspacesController = WorkspacesController = __decorate([
    (0, common_1.Controller)(),
    __metadata("design:paramtypes", [workspaces_service_1.WorkspacesService, guards_1.WorkspaceGuard])
], WorkspacesController);
//# sourceMappingURL=workspaces.controller.js.map