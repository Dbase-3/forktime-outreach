// Phone numbers. Iteration 1 uses a fake provider: the numbers offered come
// from fictional ranges (@outreach/core numbers.ts) and "buying" one just
// records it. Phase 3 swaps in Telnyx behind the same endpoints.

import { Body, Controller, Delete, Get, Param, Post } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { COUNTRIES, availableNumbers } from "@outreach/core/numbers";
import { z } from "zod";
import { Ctx, Roles } from "../../common/decorators";
import { conflict, notFound, unprocessable } from "../../common/errors";
import { oid } from "../../common/ids";
import type { RequestContext } from "../../common/request";
import { numberOut } from "../../common/serialize";
import { parse } from "../../common/zod";
import type { M } from "../../db/models";

const Search = z.object({ country: z.enum(COUNTRIES.map((c) => c.code) as [string, ...string[]]), kind: z.enum(["local", "mobile", "tollfree"]), area: z.string().max(8).default("") });

@Controller("w/:ws/numbers")
export class NumbersController {
  constructor(
    @InjectModel("PhoneNumber") private readonly numbers: M<"PhoneNumber">,
    @InjectModel("Agent") private readonly agents: M<"Agent">,
  ) {}

  @Get()
  async list(@Ctx() ctx: RequestContext) {
    return (await this.numbers.find({ workspaceId: ctx.workspaceId }).sort({ createdAt: 1 }).lean()).map(numberOut);
  }

  /** Candidates first, then only those are checked against the database (no full scan). */
  private async offers(country: string, kind: "local" | "mobile" | "tollfree", area: string, count: number) {
    const candidates = availableNumbers(country, kind, area, [], 40);
    const taken = new Set((await this.numbers.find({ e164: { $in: candidates.map((c) => c.e164) } }, { e164: 1 }).lean()).map((n) => n.e164));
    return candidates.filter((c) => !taken.has(c.e164)).slice(0, count);
  }

  @Post("search")
  async search(@Body() body: unknown) {
    const q = parse(Search, body);
    return this.offers(q.country, q.kind, q.area, 5);
  }

  @Post()
  @Roles("owner", "admin")
  async add(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    const q = parse(Search.extend({ e164: z.string().max(20) }), body);
    const offer = (await this.offers(q.country, q.kind, q.area, 40)).find((o) => o.e164 === q.e164);
    if (!offer) throw unprocessable("That number isn't available any more. Search again.");
    const doc = await this.numbers.create({ workspaceId: ctx.workspaceId, e164: offer.e164, display: offer.display, country: offer.country, kind: offer.kind, area: offer.area, provider: "fake" });
    return numberOut(doc.toObject());
  }

  @Delete(":id")
  @Roles("owner", "admin")
  async release(@Ctx() ctx: RequestContext, @Param("id") id: string) {
    const _id = oid(id, "That number");
    const user = await this.agents.findOne({ workspaceId: ctx.workspaceId, numberId: _id, deletedAt: null }).lean();
    if (user) throw conflict(`${(user.draft as { name: string }).name} uses this number. Give it another number first.`);
    const res = await this.numbers.deleteOne({ _id, workspaceId: ctx.workspaceId });
    if (!res.deletedCount) throw notFound("That number");
    return { released: true };
  }
}
