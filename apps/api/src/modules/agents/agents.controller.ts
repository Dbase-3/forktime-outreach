import { Body, Controller, Delete, Get, Param, Patch, Post, Put } from "@nestjs/common";
import { AgentDraftSchema } from "@outreach/core/schemas";
import { z } from "zod";
import { Ctx } from "../../common/decorators";
import { oid } from "../../common/ids";
import type { RequestContext } from "../../common/request";
import { parse } from "../../common/zod";
import { AgentsService } from "./agents.service";

const V = z.object({ version: z.number().int() });

@Controller("w/:ws/agents")
export class AgentsController {
  constructor(private readonly service: AgentsService) {}

  @Get()
  list(@Ctx() ctx: RequestContext) {
    return this.service.list(ctx.workspaceId!);
  }

  @Post()
  create(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    return this.service.create(ctx.workspaceId!, parse(z.object({ templateId: z.string().max(64).nullable().optional(), name: z.string().max(80).default(""), numberId: z.string().max(64).nullable().optional() }), body));
  }

  @Get(":id")
  get(@Ctx() ctx: RequestContext, @Param("id") id: string) {
    return this.service.get(ctx.workspaceId!, oid(id, "That agent"));
  }

  @Patch(":id")
  save(@Ctx() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    const { version, draft } = parse(V.extend({ draft: AgentDraftSchema.partial() }), body);
    return this.service.saveDraft(ctx.workspaceId!, oid(id, "That agent"), version, draft);
  }

  @Put(":id/number")
  number(@Ctx() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    const { version, numberId } = parse(V.extend({ numberId: z.string().max(64).nullable() }), body);
    return this.service.setNumber(ctx.workspaceId!, oid(id, "That agent"), version, numberId);
  }

  @Post(":id/publish")
  publish(@Ctx() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    return this.service.publish(ctx.workspaceId!, oid(id, "That agent"), parse(V, body).version, ctx.userId);
  }

  @Post(":id/unpublish")
  unpublish(@Ctx() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    return this.service.unpublish(ctx.workspaceId!, oid(id, "That agent"), parse(V, body).version);
  }

  @Get(":id/versions")
  versions(@Ctx() ctx: RequestContext, @Param("id") id: string) {
    return this.service.versionsOf(ctx.workspaceId!, oid(id, "That agent"));
  }

  @Post(":id/duplicate")
  duplicate(@Ctx() ctx: RequestContext, @Param("id") id: string) {
    return this.service.duplicate(ctx.workspaceId!, oid(id, "That agent"));
  }

  @Delete(":id")
  remove(@Ctx() ctx: RequestContext, @Param("id") id: string) {
    return this.service.remove(ctx.workspaceId!, oid(id, "That agent"));
  }
}
