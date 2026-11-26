// Two global guards, in order:
//   AuthGuard: every route needs a signed-in session unless marked @Public().
//   WorkspaceGuard: a route with a :ws parameter needs membership of that
//   workspace (and one of @Roles(), when given). The workspace id and role go
//   on the request context, and every service query is filtered by it.
// test/route-guards.test.ts fails if any route escapes both.

import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { InjectModel } from "@nestjs/mongoose";
import { Types } from "mongoose";
import type { Request } from "express";
import { AuthService } from "../modules/auth/auth.service";
import type { M } from "../db/models";
import type { Role } from "../db/schemas";
import { IS_PUBLIC, ROLES } from "./decorators";
import { forbidden, unauthorized } from "./errors";
import { SESSION_COOKIE, type RequestContext } from "./request";

type Req = Request & { ctx?: RequestContext };

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()]);
    const req = context.switchToHttp().getRequest<Req>();
    const ctx = await this.auth.session(req.cookies?.[SESSION_COOKIE]);
    if (ctx) req.ctx = ctx;
    if (isPublic) return true;
    if (!ctx) throw unauthorized();
    return true;
  }
}

@Injectable()
export class WorkspaceGuard implements CanActivate {
  private readonly cache = new Map<string, { role: Role | null; until: number }>();

  constructor(private readonly reflector: Reflector, @InjectModel("Membership") private readonly memberships: M<"Membership">) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Req>();
    const ws = typeof req.params?.ws === "string" ? req.params.ws : undefined;
    if (ws === undefined) return true;
    if (!req.ctx) throw unauthorized();
    if (!Types.ObjectId.isValid(ws)) throw forbidden();
    const role = await this.roleOf(String(req.ctx.userId), ws);
    if (!role) throw forbidden("You're not a member of that workspace.");
    const allowed = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES, [context.getHandler(), context.getClass()]);
    if (allowed && !allowed.includes(role)) throw forbidden(`Only ${allowed.join(" or ")}s can do that.`);
    req.ctx.workspaceId = new Types.ObjectId(ws);
    req.ctx.role = role;
    return true;
  }

  private async roleOf(userId: string, ws: string): Promise<Role | null> {
    const k = `${userId}:${ws}`;
    const hit = this.cache.get(k);
    if (hit && hit.until > Date.now()) return hit.role;
    const m = await this.memberships.findOne({ userId: new Types.ObjectId(userId), workspaceId: new Types.ObjectId(ws) }).lean();
    const role = (m?.role as Role | undefined) ?? null;
    this.cache.set(k, { role, until: Date.now() + 15_000 });
    if (this.cache.size > 20_000) this.cache.clear();
    return role;
  }

  /** Membership changed: forget cached roles for this workspace. */
  forget(ws: string): void {
    for (const k of this.cache.keys()) if (k.endsWith(`:${ws}`)) this.cache.delete(k);
  }
}
