// Analytics and Home figures, worked out on the server with the same core
// functions the prototype used in the browser, over this workspace's calls
// without transcripts. Phase 5 replaces this with daily roll-ups.

import { Body, Controller, Get, Post, Res } from "@nestjs/common";
import type { Response } from "express";
import { InjectModel } from "@nestjs/mongoose";
import { RANGES, bestTimes, byAgent, callsCsv, conversation, directions, pickCalls, pickupBreakdown, rangeBounds, summarize, timeline, topOutcomes, transfers, type RangeId } from "@outreach/core/analytics";
import { audienceOf, callRulesFor, upcomingCalls } from "@outreach/core/campaign";
import { agentStats, answered, callsPerDay, isWin } from "@outreach/core/stats";
import type { Call, Contact } from "@outreach/core/types";
import { Types } from "mongoose";
import { z } from "zod";
import { Ctx } from "../../common/decorators";
import type { RequestContext } from "../../common/request";
import { callOut } from "../../common/serialize";
import { WorkspaceData } from "../../common/workspace-data";
import { parse } from "../../common/zod";
import type { M } from "../../db/models";
import { contactOut } from "../contacts/contacts.service";
import { LIGHT } from "../calls/calls.controller";

const DAY = 86_400_000;

@Controller("w/:ws")
export class AnalyticsController {
  constructor(
    @InjectModel("Call") private readonly calls: M<"Call">,
    @InjectModel("Contact") private readonly contacts: M<"Contact">,
    private readonly data: WorkspaceData,
  ) {}

  private async callsSince(ws: Types.ObjectId, from: Date): Promise<Call[]> {
    return (await this.calls.find({ workspaceId: ws, $or: [{ startedAt: { $gte: from } }, { live: true }] }, LIGHT).lean()).map(callOut);
  }

  /** The calls a filter picks (this period and the one before), with what the figures need. */
  private async select(ws: Types.ObjectId, body: unknown) {
    const q = parse(z.object({ range: z.enum(RANGES.map((r) => r.id) as [RangeId, ...RangeId[]]).default("30d"), agentId: z.string().max(64).default(""), direction: z.enum(["all", "inbound", "outbound"]).default("all"), language: z.string().max(40).default(""), metric: z.enum(["pickup", "goal"]).default("pickup") }), body ?? {});
    const now = new Date();
    const b = rangeBounds(q.range, now);
    const [all, flows, settings] = await Promise.all([this.callsSince(ws, new Date(b.prevFrom)), this.data.flows(ws), this.data.settings(ws)]);
    const filter = { flowId: q.agentId || undefined, direction: q.direction === "all" ? undefined : q.direction, language: q.language || undefined };
    const calls = pickCalls(all, flows, b.from, b.to, filter);
    const before = pickCalls(all, flows, b.prevFrom, b.prevTo, filter);
    const ids = [...new Set(calls.flatMap((c) => (c.contactId ? [c.contactId] : [])))].filter((x) => Types.ObjectId.isValid(x)).map((x) => new Types.ObjectId(x));
    const people = (await this.contacts.find({ _id: { $in: ids }, workspaceId: ws }, { phone: 1, name: 1 }).lean()).map((p) => ({ id: String(p._id), phone: p.phone, name: p.name })) as Contact[];
    return { q, b, calls, before, flows, settings, people };
  }

  @Post("analytics")
  async analytics(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    const { q, b, calls, before, flows, settings, people } = await this.select(ctx.workspaceId!, body);
    return {
      bounds: b,
      now: { summary: summarize(calls), conversation: conversation(calls) },
      was: { summary: summarize(before), conversation: conversation(before) },
      buckets: timeline(calls, b.from, b.to),
      pickup: pickupBreakdown(calls),
      byAgent: byAgent(calls, flows, b.from, b.to).map((r) => ({ flowId: r.flow.id, summary: r.summary, trend: r.trend })),
      outcomes: topOutcomes(calls),
      directions: directions(calls),
      transfers: transfers(calls),
      bestTimes: bestTimes(calls, people, settings.timezone, q.metric),
      languages: [...new Set(flows.map((f) => f.agent.language))].sort(),
    };
  }

  /** The picked calls as a CSV (same filters as the page). */
  @Post("analytics/export")
  async export(@Ctx() ctx: RequestContext, @Body() body: unknown, @Res() res: Response) {
    const { calls, flows, people } = await this.select(ctx.workspaceId!, body);
    res.setHeader("content-type", "text/csv; charset=utf-8");
    res.setHeader("content-disposition", `attachment; filename="calls-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.status(200).send(callsCsv(calls, flows, people));
  }

  /** Everything Home shows, in one request. */
  @Get("home")
  async home(@Ctx() ctx: RequestContext) {
    const ws = ctx.workspaceId!;
    const now = new Date();
    const [calls, flows, settings, campaigns] = await Promise.all([this.callsSince(ws, new Date(now.getTime() - 15 * DAY)), this.data.flows(ws), this.data.settings(ws), this.data.campaignsOf(ws)]);
    const done = calls.filter((c) => !c.live);
    const window = (days: number) => {
      const since = now.getTime() - days * DAY;
      const inRange = done.filter((c) => new Date(c.startedAt).getTime() >= since);
      const talked = inRange.filter(answered);
      const counts = new Map<string, number>();
      inRange.forEach((c) => counts.set(c.outcome, (counts.get(c.outcome) ?? 0) + 1));
      return {
        perDay: callsPerDay(calls, days, now).map((p) => ({ day: p.day.toISOString(), calls: p.calls, wins: p.wins })),
        calls: inRange.length,
        wins: inRange.filter((c) => isWin(c.outcome)).length,
        answered: talked.length,
        talkSec: talked.reduce((s, c) => s + c.durationSec, 0),
        outcomes: [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([outcome, count]) => ({ outcome, count })),
      };
    };
    const lastCallAt = async (flowId: string) => (await this.calls.findOne({ workspaceId: ws, agentId: new Types.ObjectId(flowId), live: { $ne: true } }, { startedAt: 1 }).sort({ startedAt: -1 }).lean())?.startedAt?.toISOString() ?? null;
    const agents = Object.fromEntries(
      await Promise.all(
        flows.map(async (f) => {
          const stats = agentStats(f, calls, now);
          return [f.id, { stats: { ...stats, lastCallAt: stats.lastCallAt ?? (await lastCallAt(f.id)) }, trend: callsPerDay(calls.filter((c) => c.flowId === f.id), 14, now).map((p) => p.calls), liveCallId: calls.find((c) => c.live && c.flowId === f.id)?.id ?? null }];
        }),
      ),
    );
    const recentRows = await this.calls.find({ workspaceId: ws }, LIGHT).sort({ startedAt: -1 }).limit(5).lean();
    const recent = recentRows.map(callOut);
    const recentPeople = await this.contacts.find({ _id: { $in: recentRows.flatMap((r) => (r.contactId ? [r.contactId] : [])) } }, { name: 1, phone: 1 }).lean();

    // Who's due next in campaigns that call around a date (next 30 days).
    const rules = callRulesFor(settings);
    const dated = campaigns.filter((c) => c.status === "running" && c.mode === "always" && c.trigger.kind === "date_field");
    const upcoming: { contact: { id: string; name: string }; due: string; campaignId: string; campaignName: string }[] = [];
    for (const c of dated) {
      if (c.trigger.kind !== "date_field") continue;
      const rows = (await this.contacts.find({ workspaceId: ws, deletedAt: null, [`fields.${c.trigger.field}`]: { $exists: true } }).limit(5000).lean()).map(contactOut);
      for (const p of upcomingCalls(c, audienceOf(c, rows, now, rules), now, 30, rules)) upcoming.push({ contact: { id: p.contact.id, name: p.contact.name }, due: p.due.toISOString(), campaignId: c.id, campaignName: c.name });
    }
    upcoming.sort((a, b) => a.due.localeCompare(b.due));

    return {
      liveNow: calls.filter((c) => c.live).length,
      today: callsPerDay(calls, 1, now)[0].calls,
      agents,
      windows: { 7: window(7), 14: window(14) },
      recent: recent.map((c) => ({ call: c, contact: recentPeople.find((p) => String(p._id) === c.contactId) ? { id: c.contactId, name: recentPeople.find((p) => String(p._id) === c.contactId)!.name } : null })),
      upcoming: upcoming.slice(0, 5),
    };
  }
}
