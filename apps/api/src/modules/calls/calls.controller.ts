// Calls: a paged list (no transcripts), one call in full, feedback. Search
// covers the summary and the caller's name or number.

import { Body, Controller, Get, Param, Patch, Post } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Types, type FilterQuery } from "mongoose";
import { z } from "zod";
import { Ctx } from "../../common/decorators";
import { notFound } from "../../common/errors";
import { oid } from "../../common/ids";
import type { RequestContext } from "../../common/request";
import { callOut } from "../../common/serialize";
import { parse } from "../../common/zod";
import type { M, Row } from "../../db/models";
import { contactOut } from "../contacts/contacts.service";

const Query = z.object({
  search: z.string().max(120).default(""),
  direction: z.enum(["all", "inbound", "outbound"]).default("all"),
  agentId: z.string().max(64).default(""),
  outcome: z.string().max(64).default(""),
  action: z.string().max(40).default(""),
  contactId: z.string().max(64).default(""),
  page: z.number().int().min(1).max(10000).default(1),
  pageSize: z.number().int().min(1).max(100).default(50),
});
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const LIGHT = { transcript: 0 } as const;

@Controller("w/:ws/calls")
export class CallsController {
  constructor(@InjectModel("Call") private readonly calls: M<"Call">, @InjectModel("Contact") private readonly contacts: M<"Contact">) {}

  /** Calls with their contacts' names, newest first, live ones on top. */
  @Post("query")
  async query(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    const ws = ctx.workspaceId!;
    const q = parse(Query, body ?? {});
    const and: FilterQuery<Row<"Call">>[] = [{ workspaceId: ws }];
    if (q.direction !== "all") and.push({ direction: q.direction });
    if (q.agentId && Types.ObjectId.isValid(q.agentId)) and.push({ agentId: new Types.ObjectId(q.agentId) });
    if (q.outcome) and.push({ outcome: q.outcome });
    if (q.action) and.push({ actions: q.action });
    if (q.contactId && Types.ObjectId.isValid(q.contactId)) and.push({ contactId: new Types.ObjectId(q.contactId) });
    if (q.search.trim()) {
      const re = new RegExp(esc(q.search.trim()), "i");
      const people = await this.contacts.find({ workspaceId: ws, $or: [{ name: re }, { phone: re }] }, { _id: 1 }).limit(2000).lean();
      and.push({ $or: [{ summary: re }, { contactId: { $in: people.map((p) => p._id) } }] });
    }
    const filter = { $and: and };
    const [total, rows] = await Promise.all([this.calls.countDocuments(filter), this.calls.find(filter, LIGHT).sort({ live: -1, startedAt: -1 }).skip((q.page - 1) * q.pageSize).limit(q.pageSize).lean()]);
    return { rows: rows.map(callOut), contacts: await this.contactsFor(ws, rows), total, page: q.page, pages: Math.max(1, Math.ceil(total / q.pageSize)) };
  }

  /** How many calls are going on right now (the top bar). */
  @Get("live")
  async live(@Ctx() ctx: RequestContext) {
    return { live: await this.calls.countDocuments({ workspaceId: ctx.workspaceId, live: true }) };
  }

  @Get("outcomes")
  async outcomes(@Ctx() ctx: RequestContext) {
    return ((await this.calls.distinct("outcome", { workspaceId: ctx.workspaceId })) as string[]).filter(Boolean).sort();
  }

  @Get(":id")
  async get(@Ctx() ctx: RequestContext, @Param("id") id: string) {
    const c = await this.calls.findOne({ _id: oid(id, "That call"), workspaceId: ctx.workspaceId }).lean();
    if (!c) throw notFound("That call");
    const contact = c.contactId ? await this.contacts.findOne({ _id: c.contactId, workspaceId: ctx.workspaceId }).lean() : null;
    return { call: callOut(c), contact: contact ? contactOut(contact) : null };
  }

  @Patch(":id/feedback")
  async feedback(@Ctx() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    const { feedback } = parse(z.object({ feedback: z.object({ rating: z.enum(["up", "down"]), reasons: z.array(z.enum(["misunderstood", "wrong_info", "booking_mistake", "talked_over", "should_transfer", "robotic", "other"])).max(7), note: z.string().max(2000), at: z.string().max(40) }).nullable() }), body);
    const c = await this.calls.findOneAndUpdate({ _id: oid(id, "That call"), workspaceId: ctx.workspaceId }, { $set: { feedback } }, { new: true, projection: LIGHT }).lean();
    if (!c) throw notFound("That call");
    return callOut(c);
  }

  async contactsFor(ws: Types.ObjectId, rows: Row<"Call">[]) {
    const ids = [...new Set(rows.flatMap((r) => (r.contactId ? [String(r.contactId)] : [])))].map((x) => new Types.ObjectId(x));
    const people = await this.contacts.find({ _id: { $in: ids }, workspaceId: ws }).lean();
    return Object.fromEntries(people.map((p) => [String(p._id), { id: String(p._id), name: p.name, phone: p.phone }]));
  }
}
