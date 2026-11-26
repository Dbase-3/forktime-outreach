import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { EmailSchema, SettingsSchema } from "@outreach/core/schemas";
import { z } from "zod";
import { Ctx, Roles } from "../../common/decorators";
import { oid } from "../../common/ids";
import type { RequestContext } from "../../common/request";
import { parse } from "../../common/zod";
import { ROLES, type Role } from "../../db/schemas";
import { WorkspaceGuard } from "../../common/guards";
import { WorkspacesService } from "./workspaces.service";

const CreateSchema = z.object({ name: z.string().trim().min(1).max(120), timezone: z.string().max(64).default("Australia/Sydney"), sample: z.boolean().default(false) });

@Controller()
export class WorkspacesController {
  constructor(private readonly service: WorkspacesService, private readonly guard: WorkspaceGuard) {}

  @Post("workspaces")
  create(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    return this.service.create(ctx.userId, parse(CreateSchema, body));
  }

  @Get("w/:ws")
  get(@Ctx() ctx: RequestContext) {
    return this.service.get(ctx.workspaceId!, ctx.role!);
  }

  @Get("w/:ws/bootstrap")
  bootstrap(@Ctx() ctx: RequestContext) {
    return this.service.bootstrap(ctx.workspaceId!, ctx.role!);
  }

  @Patch("w/:ws/settings")
  @Roles("owner", "admin")
  settings(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    const { version, settings } = parse(z.object({ version: z.number().int(), settings: SettingsSchema }), body);
    return this.service.saveSettings(ctx.workspaceId!, version, settings);
  }

  @Get("w/:ws/members")
  members(@Ctx() ctx: RequestContext) {
    return this.service.members(ctx.workspaceId!);
  }

  @Post("w/:ws/invites")
  @Roles("owner", "admin")
  invite(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    const { email, role } = parse(z.object({ email: EmailSchema, role: z.enum(ROLES).default("member") }), body);
    return this.service.invite(ctx.workspaceId!, ctx.userId, ctx.email, email, role, ctx.role!);
  }

  @Delete("w/:ws/invites/:inviteId")
  @Roles("owner", "admin")
  cancelInvite(@Ctx() ctx: RequestContext, @Param("inviteId") inviteId: string) {
    return this.service.cancelInvite(ctx.workspaceId!, oid(inviteId, "That invite"));
  }

  @Patch("w/:ws/members/:userId")
  @Roles("owner")
  async role(@Ctx() ctx: RequestContext, @Param("userId") userId: string, @Body() body: unknown) {
    const { role } = parse(z.object({ role: z.enum(ROLES) }), body);
    const out = await this.service.setRole(ctx.workspaceId!, oid(userId, "That member"), role as Role);
    this.guard.forget(String(ctx.workspaceId));
    return out;
  }

  @Delete("w/:ws/members/:userId")
  @Roles("owner", "admin")
  async remove(@Ctx() ctx: RequestContext, @Param("userId") userId: string) {
    const out = await this.service.remove(ctx.workspaceId!, oid(userId, "That member"));
    this.guard.forget(String(ctx.workspaceId));
    return out;
  }
}
