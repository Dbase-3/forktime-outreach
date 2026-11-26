import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res } from "@nestjs/common";
import { allColumns } from "@outreach/core/contacts-table";
import { ContactInputSchema, ContactQuerySchema } from "@outreach/core/schemas";
import type { Response } from "express";
import { Types } from "mongoose";
import { z } from "zod";
import { Ctx } from "../../common/decorators";
import { oid } from "../../common/ids";
import type { RequestContext } from "../../common/request";
import { WorkspaceData } from "../../common/workspace-data";
import { parse } from "../../common/zod";
import { ContactsService, contactOut } from "./contacts.service";
import { plainFields } from "./typed-fields";

const Target = z.union([z.object({ ids: z.array(z.string().max(64)).min(1).max(5000) }), z.object({ query: ContactQuerySchema.pick({ search: true, list: true, filter: true }) })]);
const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

@Controller("w/:ws/contacts")
export class ContactsController {
  constructor(private readonly service: ContactsService, private readonly data: WorkspaceData) {}

  @Post("query")
  query(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    return this.service.query(ctx.workspaceId!, parse(ContactQuerySchema, body ?? {}));
  }

  @Get("lists")
  lists(@Ctx() ctx: RequestContext) {
    return this.service.lists(ctx.workspaceId!);
  }

  /** A few contacts, for pickers like the agent preview's "Calling …". */
  @Get("sample")
  async sample(@Ctx() ctx: RequestContext, @Query("limit") limit?: string) {
    const out = await this.service.query(ctx.workspaceId!, parse(ContactQuerySchema, { pageSize: Math.min(100, Number(limit) || 30) }));
    return out.rows;
  }

  @Post("by-ids")
  byIds(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    return this.service.byIds(ctx.workspaceId!, parse(z.object({ ids: z.array(z.string().max(64)).max(500) }), body).ids);
  }

  @Post()
  create(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    return this.service.create(ctx.workspaceId!, parse(ContactInputSchema, body));
  }

  @Get(":id")
  get(@Ctx() ctx: RequestContext, @Param("id") id: string) {
    return this.service.get(ctx.workspaceId!, oid(id, "That contact"));
  }

  @Patch(":id")
  save(@Ctx() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    const { version, ...patch } = parse(ContactInputSchema.partial().extend({ version: z.number().int() }), body);
    return this.service.save(ctx.workspaceId!, oid(id, "That contact"), version, patch);
  }

  @Delete(":id")
  remove(@Ctx() ctx: RequestContext, @Param("id") id: string) {
    return this.service.remove(ctx.workspaceId!, { _id: oid(id, "That contact") });
  }

  /** Delete, or add to / remove from a list, for picked ids or everyone matching a query. */
  @Post("bulk")
  async bulk(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    const ws = ctx.workspaceId!;
    const input = parse(z.object({ action: z.enum(["delete", "add_list", "remove_list"]), list: z.string().max(80).optional(), target: Target }), body);
    const filter = "ids" in input.target ? { _id: { $in: input.target.ids.filter((x) => Types.ObjectId.isValid(x)).map((x) => new Types.ObjectId(x)) } } : await this.service.filterFor(ws, input.target.query);
    if (input.action === "delete") return this.service.remove(ws, filter);
    if (!input.list?.trim()) return { changed: 0 };
    return this.service.setList(ws, filter, input.list.trim(), input.action === "add_list");
  }

  /** CSV of everyone matching the query, streamed in batches. */
  @Post("export")
  async export(@Ctx() ctx: RequestContext, @Body() body: unknown, @Res() res: Response) {
    const ws = ctx.workspaceId!;
    const q = parse(ContactQuerySchema.pick({ search: true, list: true, filter: true }).extend({ ids: z.array(z.string().max(64)).max(5000).optional() }), body ?? {});
    const defs = await this.data.defs(ws);
    const byIds = q.ids?.length ? { workspaceId: ws, deletedAt: null, _id: { $in: q.ids.filter((x) => Types.ObjectId.isValid(x)).map((x) => new Types.ObjectId(x)) } } : null;
    const columns = allColumns(defs);
    res.setHeader("content-type", "text/csv; charset=utf-8");
    res.status(200);
    res.setHeader("content-disposition", 'attachment; filename="contacts.csv"');
    res.write(columns.map((c) => cell(c.label)).join(",") + "\n");
    for await (const c of this.service.cursor(byIds ?? (await this.service.filterFor(ws, q, defs)))) {
      const out = contactOut(c);
      const values: Record<string, string> = { ...plainFields(c.fields as Record<string, unknown>), name: out.name, phone: out.phone, email: out.email ?? "", lists: out.groups.join(", "), last_call: out.lastCallAt?.slice(0, 10) ?? "", last_outcome: out.lastOutcome ?? "", created: out.createdAt.slice(0, 10) };
      res.write(columns.map((col) => cell(values[col.key] ?? "")).join(",") + "\n");
    }
    res.end();
  }
}
