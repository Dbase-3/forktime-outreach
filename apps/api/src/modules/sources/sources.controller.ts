// Where contacts come from: CSV imports (made by the import job) and CRM /
// sheet syncs. A connected GoHighLevel or Twenty really syncs (ContactSync:
// name, phone, email); other tools still only save the setup, so their
// "Sync now" only notes the time. Removing a source keeps its contacts.

import { Body, Controller, Delete, Get, Param, Post } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { integrationInfo } from "@outreach/core/integrations";
import { FieldDefSchema } from "@outreach/core/schemas";
import { z } from "zod";
import { Ctx } from "../../common/decorators";
import { notFound, unprocessable } from "../../common/errors";
import { oid } from "../../common/ids";
import type { RequestContext } from "../../common/request";
import { fieldOut, sourceOut } from "../../common/serialize";
import { parse } from "../../common/zod";
import type { M } from "../../db/models";
import { USABLE } from "../../common/workspace-data";
import { ContactSyncService, isLiveSync } from "./contact-sync.service";

const SyncInput = z.object({
  integrationId: z.string().max(64),
  object: z.string().min(1).max(80),
  list: z.string().max(80).default(""),
  syncEvery: z.enum(["15m", "1h", "1d"]).default("1h"),
  fields: z.array(FieldDefSchema.pick({ key: true, label: true, type: true })).max(200).default([]),
});

@Controller("w/:ws/sources")
export class SourcesController {
  constructor(
    @InjectModel("Source") private readonly sources: M<"Source">,
    @InjectModel("FieldDef") private readonly fields: M<"FieldDef">,
    @InjectModel("Integration") private readonly integrations: M<"Integration">,
    private readonly sync: ContactSyncService,
  ) {}

  @Get()
  async list(@Ctx() ctx: RequestContext) {
    return (await this.sources.find({ workspaceId: ctx.workspaceId }).sort({ createdAt: -1 }).lean()).map(sourceOut);
  }

  /** A CRM / sheet sync. Its fields are added (ones that already exist are kept as they are). */
  @Post()
  async addSync(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    const input = parse(SyncInput, body);
    const ws = ctx.workspaceId!;
    const info = integrationInfo(input.integrationId);
    if (!info?.syncsContacts) throw unprocessable("That tool can't sync contacts.");
    if (!(await this.integrations.exists({ workspaceId: ws, providerId: input.integrationId, ...USABLE }))) throw unprocessable(`Connect ${info.name} first.`);
    const live = isLiveSync(info.id);
    const src = await this.sources.create({ workspaceId: ws, kind: "sync", integrationId: info.id, name: `${info.name} · ${input.object}`, object: input.object, list: input.list.trim() || `${info.name} ${input.object.toLowerCase()}`, fieldKeys: live ? [] : input.fields.map((f) => f.key), rows: 0, syncEvery: input.syncEvery, lastSyncAt: new Date(), status: "syncing" });
    if (live) await this.sync.start(src._id);
    for (const f of live ? [] : input.fields) await this.fields.updateOne({ workspaceId: ws, key: f.key }, { $setOnInsert: { label: f.label, type: f.type, source: String(src._id) } }, { upsert: true });
    const fieldDefs = (await this.fields.find({ workspaceId: ws }).sort({ createdAt: 1 }).lean()).map(fieldOut);
    return { source: sourceOut((await this.sources.findById(src._id).lean())!), fieldDefs };
  }

  @Post(":id/sync")
  async syncNow(@Ctx() ctx: RequestContext, @Param("id") id: string) {
    const found = await this.sources.findOne({ _id: oid(id, "That source"), workspaceId: ctx.workspaceId, kind: "sync" }).lean();
    if (found && isLiveSync(found.integrationId)) {
      await this.sync.start(found._id);
      return sourceOut((await this.sources.findById(found._id).lean())!);
    }
    const src = await this.sources.findOneAndUpdate({ _id: oid(id, "That source"), workspaceId: ctx.workspaceId, kind: "sync" }, { $set: { lastSyncAt: new Date() } }, { new: true }).lean();
    if (!src) throw notFound("That source");
    return sourceOut(src);
  }

  @Delete(":id")
  async remove(@Ctx() ctx: RequestContext, @Param("id") id: string) {
    const res = await this.sources.deleteOne({ _id: oid(id, "That source"), workspaceId: ctx.workspaceId });
    if (!res.deletedCount) throw notFound("That source");
    return { removed: true };
  }
}
