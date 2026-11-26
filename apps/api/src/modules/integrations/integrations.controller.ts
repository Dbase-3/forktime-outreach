// Integrations: iteration 1 only remembers that a tool is connected and to
// which account (real OAuth connections are Phase 6).

import { Body, Controller, Delete, Get, Param, Put } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { integrationInfo } from "@outreach/core/integrations";
import { z } from "zod";
import { Ctx, Roles } from "../../common/decorators";
import { notFound } from "../../common/errors";
import type { RequestContext } from "../../common/request";
import { integrationOut } from "../../common/serialize";
import { parse } from "../../common/zod";
import type { M } from "../../db/models";

@Controller("w/:ws/integrations")
export class IntegrationsController {
  constructor(@InjectModel("Integration") private readonly integrations: M<"Integration">) {}

  @Get()
  async list(@Ctx() ctx: RequestContext) {
    return (await this.integrations.find({ workspaceId: ctx.workspaceId }).lean()).map(integrationOut);
  }

  @Put(":provider")
  @Roles("owner", "admin")
  async connect(@Ctx() ctx: RequestContext, @Param("provider") provider: string, @Body() body: unknown) {
    if (!integrationInfo(provider)) throw notFound("That integration");
    const { account } = parse(z.object({ account: z.string().max(200).default("") }), body ?? {});
    const doc = await this.integrations.findOneAndUpdate({ workspaceId: ctx.workspaceId, providerId: provider }, { $set: { connected: true, account } }, { upsert: true, new: true }).lean();
    return integrationOut(doc!);
  }

  @Delete(":provider")
  @Roles("owner", "admin")
  async disconnect(@Ctx() ctx: RequestContext, @Param("provider") provider: string) {
    await this.integrations.deleteOne({ workspaceId: ctx.workspaceId, providerId: provider });
    return { disconnected: true };
  }
}
