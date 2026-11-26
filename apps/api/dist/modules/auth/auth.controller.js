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
exports.AuthController = void 0;
const common_1 = require("@nestjs/common");
const mongoose_1 = require("@nestjs/mongoose");
const schemas_1 = require("@outreach/core/schemas");
const zod_1 = require("zod");
const decorators_1 = require("../../common/decorators");
const request_1 = require("../../common/request");
const zod_2 = require("../../common/zod");
const auth_service_1 = require("./auth.service");
const ip = (req) => req.headers["x-real-ip"] || req.ip || "unknown";
let AuthController = class AuthController {
    auth;
    memberships;
    workspaces;
    users;
    constructor(auth, memberships, workspaces, users) {
        this.auth = auth;
        this.memberships = memberships;
        this.workspaces = workspaces;
        this.users = users;
    }
    /** Always answers the same, so it can't be used to find out who has an account. */
    async code(body, req) {
        const { email } = (0, zod_2.parse)(zod_1.z.object({ email: schemas_1.EmailSchema }), body);
        await this.auth.requestCode(email, ip(req));
        return { sent: true };
    }
    async verify(body, req, res) {
        const { email, code } = (0, zod_2.parse)(zod_1.z.object({ email: schemas_1.EmailSchema, code: zod_1.z.string().trim().regex(/^\d{6}$/, "The code is 6 digits.") }), body);
        const { token } = await this.auth.verify(email, code, ip(req), String(req.headers["user-agent"] ?? ""));
        res.cookie(request_1.SESSION_COOKIE, token, this.auth.cookieOptions());
        return { signedIn: true };
    }
    async logout(req, res) {
        await this.auth.logout(req.cookies?.[request_1.SESSION_COOKIE]);
        res.clearCookie(request_1.SESSION_COOKIE, { path: "/" });
        return { signedIn: false };
    }
    async me(ctx) {
        const [user, mine] = await Promise.all([this.users.findById(ctx.userId).lean(), this.memberships.find({ userId: ctx.userId }).lean()]);
        const spaces = await this.workspaces.find({ _id: { $in: mine.map((m) => m.workspaceId) } }, { name: 1 }).lean();
        return {
            user: { id: String(ctx.userId), email: ctx.email, name: user?.name ?? "" },
            workspaces: spaces.map((w) => ({ id: String(w._id), name: w.name, role: mine.find((m) => String(m.workspaceId) === String(w._id))?.role })),
        };
    }
};
exports.AuthController = AuthController;
__decorate([
    (0, decorators_1.Public)(),
    (0, common_1.Post)("auth/code"),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "code", null);
__decorate([
    (0, decorators_1.Public)(),
    (0, common_1.Post)("auth/verify"),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Req)()),
    __param(2, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "verify", null);
__decorate([
    (0, decorators_1.Public)(),
    (0, common_1.Post)("auth/logout"),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "logout", null);
__decorate([
    (0, common_1.Get)("me"),
    __param(0, (0, decorators_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "me", null);
exports.AuthController = AuthController = __decorate([
    (0, common_1.Controller)(),
    __param(1, (0, mongoose_1.InjectModel)("Membership")),
    __param(2, (0, mongoose_1.InjectModel)("Workspace")),
    __param(3, (0, mongoose_1.InjectModel)("User")),
    __metadata("design:paramtypes", [auth_service_1.AuthService, Object, Object, Object])
], AuthController);
//# sourceMappingURL=auth.controller.js.map