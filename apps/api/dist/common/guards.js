"use strict";
// Two global guards, in order:
//   AuthGuard: every route needs a signed-in session unless marked @Public().
//   WorkspaceGuard: a route with a :ws parameter needs membership of that
//   workspace (and one of @Roles(), when given). The workspace id and role go
//   on the request context, and every service query is filtered by it.
// test/route-guards.test.ts fails if any route escapes both.
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
exports.WorkspaceGuard = exports.AuthGuard = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const mongoose_1 = require("@nestjs/mongoose");
const mongoose_2 = require("mongoose");
const auth_service_1 = require("../modules/auth/auth.service");
const decorators_1 = require("./decorators");
const errors_1 = require("./errors");
const request_1 = require("./request");
let AuthGuard = class AuthGuard {
    reflector;
    auth;
    constructor(reflector, auth) {
        this.reflector = reflector;
        this.auth = auth;
    }
    async canActivate(context) {
        const isPublic = this.reflector.getAllAndOverride(decorators_1.IS_PUBLIC, [context.getHandler(), context.getClass()]);
        const req = context.switchToHttp().getRequest();
        const ctx = await this.auth.session(req.cookies?.[request_1.SESSION_COOKIE]);
        if (ctx)
            req.ctx = ctx;
        if (isPublic)
            return true;
        if (!ctx)
            throw (0, errors_1.unauthorized)();
        return true;
    }
};
exports.AuthGuard = AuthGuard;
exports.AuthGuard = AuthGuard = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_1.Reflector, auth_service_1.AuthService])
], AuthGuard);
let WorkspaceGuard = class WorkspaceGuard {
    reflector;
    memberships;
    cache = new Map();
    constructor(reflector, memberships) {
        this.reflector = reflector;
        this.memberships = memberships;
    }
    async canActivate(context) {
        const req = context.switchToHttp().getRequest();
        const ws = typeof req.params?.ws === "string" ? req.params.ws : undefined;
        if (ws === undefined)
            return true;
        if (!req.ctx)
            throw (0, errors_1.unauthorized)();
        if (!mongoose_2.Types.ObjectId.isValid(ws))
            throw (0, errors_1.forbidden)();
        const role = await this.roleOf(String(req.ctx.userId), ws);
        if (!role)
            throw (0, errors_1.forbidden)("You're not a member of that workspace.");
        const allowed = this.reflector.getAllAndOverride(decorators_1.ROLES, [context.getHandler(), context.getClass()]);
        if (allowed && !allowed.includes(role))
            throw (0, errors_1.forbidden)(`Only ${allowed.join(" or ")}s can do that.`);
        req.ctx.workspaceId = new mongoose_2.Types.ObjectId(ws);
        req.ctx.role = role;
        return true;
    }
    async roleOf(userId, ws) {
        const k = `${userId}:${ws}`;
        const hit = this.cache.get(k);
        if (hit && hit.until > Date.now())
            return hit.role;
        const m = await this.memberships.findOne({ userId: new mongoose_2.Types.ObjectId(userId), workspaceId: new mongoose_2.Types.ObjectId(ws) }).lean();
        const role = m?.role ?? null;
        this.cache.set(k, { role, until: Date.now() + 15_000 });
        if (this.cache.size > 20_000)
            this.cache.clear();
        return role;
    }
    /** Membership changed: forget cached roles for this workspace. */
    forget(ws) {
        for (const k of this.cache.keys())
            if (k.endsWith(`:${ws}`))
                this.cache.delete(k);
    }
};
exports.WorkspaceGuard = WorkspaceGuard;
exports.WorkspaceGuard = WorkspaceGuard = __decorate([
    (0, common_1.Injectable)(),
    __param(1, (0, mongoose_1.InjectModel)("Membership")),
    __metadata("design:paramtypes", [core_1.Reflector, Object])
], WorkspaceGuard);
//# sourceMappingURL=guards.js.map