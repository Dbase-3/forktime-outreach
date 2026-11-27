// Integrations. Ones with an API key in the catalog (Cal.com) connect for real:
// the key is checked with the provider and stored sealed (ConnectionsService).
// The rest still only remember which account (real OAuth is Phase 6).

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
import { ConnectionsService } from "./connections.service";

@Controller("w/:ws/integrations")
export class IntegrationsController {
  constructor(
    @InjectModel("Integration") private readonly integrations: M<"Integration">,
    private readonly connections: ConnectionsService,
  ) {}

  @Get()
  async list(@Ctx() ctx: RequestContext) {
    return (await this.integrations.find({ workspaceId: ctx.workspaceId }).lean()).map(integrationOut);
  }

  @Put(":provider")
  @Roles("owner", "admin")
  async connect(@Ctx() ctx: RequestContext, @Param("provider") provider: string, @Body() body: unknown) {
    const info = integrationInfo(provider);
    if (!info) throw notFound("That integration");
    if (info.apiKey) {
      const { apiKey } = parse(z.object({ apiKey: z.string().trim().min(8, "Paste the whole key.").max(500) }), body ?? {});
      return this.connections.connectWithKey(ctx.workspaceId!, provider, apiKey);
    }
    const { account } = parse(z.object({ account: z.string().max(200).default("") }), body ?? {});
    const doc = await this.integrations.findOneAndUpdate({ workspaceId: ctx.workspaceId, providerId: provider }, { $set: { connected: true, account } }, { upsert: true, new: true }).lean();
    return integrationOut(doc!);
  }

  /** A connected calendar's event types (to pick which one calls book into). */
  @Get(":provider/event-types")
  eventTypes(@Ctx() ctx: RequestContext, @Param("provider") provider: string) {
    return this.connections.eventTypes(ctx.workspaceId!, provider);
  }

  @Put(":provider/event-type")
  @Roles("owner", "admin")
  setEventType(@Ctx() ctx: RequestContext, @Param("provider") provider: string, @Body() body: unknown) {
    const { id } = parse(z.object({ id: z.number().int().positive() }), body ?? {});
    return this.connections.setEventType(ctx.workspaceId!, provider, id);
  }

  @Delete(":provider")
  @Roles("owner", "admin")
  async disconnect(@Ctx() ctx: RequestContext, @Param("provider") provider: string) {
    await this.integrations.deleteOne({ workspaceId: ctx.workspaceId, providerId: provider });
    return { disconnected: true };
  }
}
