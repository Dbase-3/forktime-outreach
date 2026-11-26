// Campaigns. Audiences are counted in the database (core rules → MongoDB,
// minus the do-not-call list and numbers that can't be dialled). Starting runs
// core campaignIssues on the server. While running, the agent, audience,
// timing and trigger are locked: pause first (roadmap §2.2).

import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { campaignIssues, defaultCampaign, dueDate } from "@outreach/core/campaign";
import { countryOfZone, dncSet } from "@outreach/core/phone";
import { CAMPAIGN_LOCKED_WHILE_RUNNING, CampaignInputSchema } from "@outreach/core/schemas";
import type { Campaign } from "@outreach/core/types";
import type { FilterQuery, Types } from "mongoose";
import { z } from "zod";
import { Ctx } from "../../common/decorators";
import { conflict, notFound, unprocessable } from "../../common/errors";
import { oid } from "../../common/ids";
import type { RequestContext } from "../../common/request";
import { campaignOut } from "../../common/serialize";
import { saveVersioned } from "../../common/versioned";
import { WorkspaceData } from "../../common/workspace-data";
import { parse } from "../../common/zod";
import type { M, Row } from "../../db/models";
import { ContactsService, contactOut } from "../contacts/contacts.service";

const V = z.object({ version: z.number().int() });

@Controller("w/:ws/campaigns")
export class CampaignsController {
  constructor(
    @InjectModel("Campaign") private readonly campaigns: M<"Campaign">,
    @InjectModel("Contact") private readonly contacts: M<"Contact">,
    private readonly people: ContactsService,
    private readonly data: WorkspaceData,
  ) {}

  /** Who the campaign would call right now, and who it skips and why. */
  private async audience(ws: Types.ObjectId, c: Pick<Campaign, "audience">) {
    const settings = await this.data.settings(ws);
    const dnc = [...dncSet(settings.doNotCall, countryOfZone(settings.timezone))];
    const base = await this.people.filterFor(ws, { search: "", list: c.audience.list, filter: c.audience.filter });
    const [included, badPhone, doNotCall] = await Promise.all([
      this.contacts.countDocuments({ $and: [base, { phoneE164: { $type: "string", $nin: dnc } }] } as FilterQuery<Row<"Contact">>),
      this.contacts.countDocuments({ $and: [base, { phoneE164: null }] } as FilterQuery<Row<"Contact">>),
      dnc.length ? this.contacts.countDocuments({ $and: [base, { phoneE164: { $in: dnc } }] } as FilterQuery<Row<"Contact">>) : 0,
    ]);
    return { count: included, skipped: { doNotCall, badPhone }, filter: { $and: [base, { phoneE164: { $type: "string", $nin: dnc } }] } as FilterQuery<Row<"Contact">> };
  }

  private async load(ws: Types.ObjectId, id: string) {
    const c = await this.campaigns.findOne({ _id: oid(id, "That campaign"), workspaceId: ws, deletedAt: null }).lean();
    if (!c) throw notFound("That campaign");
    return c;
  }

  private async issues(ws: Types.ObjectId, c: Campaign) {
    const [flows, defs, settings, aud] = await Promise.all([this.data.flows(ws), this.data.defs(ws), this.data.settings(ws), this.audience(ws, c)]);
    return campaignIssues(c, { flows, defs, audienceCount: aud.count, workspace: settings });
  }

  @Get()
  async list(@Ctx() ctx: RequestContext) {
    const rows = (await this.campaigns.find({ workspaceId: ctx.workspaceId, deletedAt: null }).sort({ createdAt: -1 }).lean()).map(campaignOut);
    return Promise.all(rows.map(async (c) => ({ ...c, audienceCount: (await this.audience(ctx.workspaceId!, c)).count, firstIssue: (await this.issues(ctx.workspaceId!, c))[0] ?? null })));
  }

  @Post()
  async create(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    const { agentId, name } = parse(z.object({ agentId: z.string().max(64), name: z.string().max(120).optional() }), body ?? {});
    const { id: _i, status: _s, called: _c, answered: _a, createdAt: _t, ...config } = defaultCampaign(agentId);
    const doc = await this.campaigns.create({ workspaceId: ctx.workspaceId, config: { ...config, name: name || config.name } });
    return campaignOut(doc.toObject());
  }

  /** Audience and start checks for a campaign as it is on screen now (before its edits have saved). */
  @Post("check")
  async check(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    const { config, status } = parse(z.object({ config: CampaignInputSchema, status: z.enum(["draft", "running", "paused", "done"]).default("draft") }), body);
    const c = { ...config, id: "check", status, called: 0, answered: 0, createdAt: new Date().toISOString() } as Campaign;
    const aud = await this.audience(ctx.workspaceId!, c);
    return { audienceCount: aud.count, skipped: aud.skipped, issues: await this.issues(ctx.workspaceId!, c), upcoming: await this.dueSoon(ctx.workspaceId!, c, aud.filter) };
  }

  @Get(":id")
  async get(@Ctx() ctx: RequestContext, @Param("id") id: string) {
    const c = campaignOut(await this.load(ctx.workspaceId!, id));
    const aud = await this.audience(ctx.workspaceId!, c);
    return { ...c, audienceCount: aud.count, skipped: aud.skipped, issues: await this.issues(ctx.workspaceId!, c) };
  }

  @Patch(":id")
  async save(@Ctx() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    const { version, ...patch } = parse(V.merge(CampaignInputSchema.partial()), body);
    const current = await this.load(ctx.workspaceId!, id);
    if (current.status === "running") {
      const locked = CAMPAIGN_LOCKED_WHILE_RUNNING.filter((k) => k in patch && JSON.stringify((patch as Record<string, unknown>)[k]) !== JSON.stringify((current.config as Record<string, unknown>)[k]));
      if (locked.length) throw conflict("Pause the campaign to change who it calls, when, or with which agent.", { locked });
    }
    const config = parse(CampaignInputSchema, { ...(current.config as object), ...patch });
    return campaignOut(await saveVersioned(this.campaigns, { _id: current._id, workspaceId: ctx.workspaceId! }, version, { $set: { config } }, campaignOut, "That campaign"));
  }

  @Post(":id/start")
  async start(@Ctx() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    const { version } = parse(V, body);
    const current = await this.load(ctx.workspaceId!, id);
    const issues = await this.issues(ctx.workspaceId!, campaignOut(current));
    if (issues.length) throw unprocessable("Fix these before starting.", { issues });
    return campaignOut(await saveVersioned(this.campaigns, { _id: current._id, workspaceId: ctx.workspaceId! }, version, { $set: { status: "running" } }, campaignOut, "That campaign"));
  }

  @Post(":id/pause")
  async pause(@Ctx() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    const { version } = parse(V, body);
    const current = await this.load(ctx.workspaceId!, id);
    return campaignOut(await saveVersioned(this.campaigns, { _id: current._id, workspaceId: ctx.workspaceId! }, version, { $set: { status: "paused" } }, campaignOut, "That campaign"));
  }

  @Delete(":id")
  async remove(@Ctx() ctx: RequestContext, @Param("id") id: string) {
    const res = await this.campaigns.updateOne({ _id: oid(id, "That campaign"), workspaceId: ctx.workspaceId, deletedAt: null }, { $set: { deletedAt: new Date(), status: "done" } });
    if (!res.matchedCount) throw notFound("That campaign");
    return { deleted: true };
  }

  /** For "Keep calling around a date": who's due in the next 60 days, soonest first. */
  @Get(":id/upcoming")
  async upcoming(@Ctx() ctx: RequestContext, @Param("id") id: string) {
    const c = campaignOut(await this.load(ctx.workspaceId!, id));
    const aud = await this.audience(ctx.workspaceId!, c);
    return this.dueSoon(ctx.workspaceId!, c, aud.filter);
  }

  private async dueSoon(_ws: Types.ObjectId, c: Campaign, filter: FilterQuery<Row<"Contact">>) {
    if (c.mode !== "always" || c.trigger.kind !== "date_field" || !c.trigger.field) return { total: 0, next: [] };
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const horizon = today + 60 * 86_400_000;
    const due: { contact: { id: string; name: string }; due: string }[] = [];
    for await (const row of this.people.cursor({ $and: [filter, { [`fields.${c.trigger.field}`]: { $exists: true } }] } as FilterQuery<Row<"Contact">>)) {
      const contact = contactOut(row);
      const d = dueDate(c.trigger, contact);
      if (d && d.getTime() >= today && d.getTime() <= horizon) due.push({ contact: { id: contact.id, name: contact.name }, due: d.toISOString() });
    }
    due.sort((a, b) => a.due.localeCompare(b.due));
    return { total: due.length, next: due.slice(0, 10) };
  }
}
