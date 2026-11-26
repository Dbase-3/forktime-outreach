// Route markers read by the guards: @Public() skips sign-in; @Roles() limits a
// workspace route to some roles. Everything else needs a signed-in member.

import { SetMetadata, createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { Role } from "../db/schemas";
import type { RequestContext } from "./request";

export const IS_PUBLIC = "isPublic";
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const ROLES = "roles";
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

/** The signed-in user and, on /w/:ws routes, the workspace and role. */
export const Ctx = createParamDecorator((_data: unknown, ctx: ExecutionContext): RequestContext => ctx.switchToHttp().getRequest().ctx);
