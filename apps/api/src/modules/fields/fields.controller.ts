// Contact fields. A field in use (campaign rules, triggers, saved answers,
// agent decisions or lines; @outreach/core field-usage) can't be removed, and
// changing its type needs `confirm` (audit B23). Changing the type converts
// the stored values so filters keep working.

import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { fieldUsage } from "@outreach/core/field-usage";
import { FieldDefSchema } from "@outreach/core/schemas";
import type { FieldType } from "@outreach/core/types";
import { z } from "zod";
import { Ctx } from "../../common/decorators";
import { conflict, notFound } from "../../common/errors";
import type { RequestContext } from "../../common/request";
import { fieldOut } from "../../common/serialize";
import { WorkspaceData } from "../../common/workspace-data";
import { parse } from "../../common/zod";
import type { M } from "../../db/models";
import { plainFields, storeValue } from "../contacts/typed-fields";

@Controller("w/:ws/fields")
export class FieldsController {
  constructor(
    @InjectModel("FieldDef") private readonly fields: M<"FieldDef">,
    @InjectModel("Contact") private readonly contacts: M<"Contact">,
    private readonly data: WorkspaceData,
  ) {}

  @Get()
  async list(@Ctx() ctx: RequestContext) {
    return (await this.fields.find({ workspaceId: ctx.workspaceId }).sort({ createdAt: 1 }).lean()).map(fieldOut);
  }

  @Post()
  async add(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    const def = parse(FieldDefSchema, body);
    if (["name", "phone", "email", "lists", "created", "last_call", "last_outcome"].includes(def.key)) throw conflict(`“${def.key}” is a built-in column. Pick another name.`);
    const doc = await this.fields.create({ workspaceId: ctx.workspaceId, ...def });
    return fieldOut(doc.toObject());
  }

  @Patch(":key")
  async edit(@Ctx() ctx: RequestContext, @Param("key") key: string, @Body() body: unknown) {
    const patch = parse(z.object({ label: z.string().min(1).max(100).optional(), type: FieldDefSchema.shape.type.optional(), choices: z.array(z.string().max(100)).max(50).optional(), confirm: z.boolean().default(false) }), body);
    const ws = ctx.workspaceId!;
    const def = await this.fields.findOne({ workspaceId: ws, key }).lean();
    if (!def) throw notFound("That field");
    if (patch.type && patch.type !== def.type) {
      const uses = await this.usesOf(ws, key);
      if (uses.length && !patch.confirm) throw conflict("Rules on this field may stop matching.", { uses });
      await this.convert(ws, key, patch.type);
    }
    const { confirm: _c, ...set } = patch;
    const next = await this.fields.findOneAndUpdate({ workspaceId: ws, key }, { $set: set }, { new: true }).lean();
    return fieldOut(next!);
  }

  @Delete(":key")
  async remove(@Ctx() ctx: RequestContext, @Param("key") key: string) {
    const ws = ctx.workspaceId!;
    const uses = await this.usesOf(ws, key);
    if (uses.length) throw conflict("This field is in use. Change those first.", { uses });
    const res = await this.fields.deleteOne({ workspaceId: ws, key });
    if (!res.deletedCount) throw notFound("That field");
    return { removed: true }; // values stay on contacts, hidden, in case it's added back
  }

  private async usesOf(ws: import("mongoose").Types.ObjectId, key: string) {
    const [flows, campaigns] = await Promise.all([this.data.flows(ws), this.data.campaignsOf(ws)]);
    return fieldUsage({ flows, campaigns }, key);
  }

  /** Re-stores every value of the field as the new type, in batches. */
  private async convert(ws: import("mongoose").Types.ObjectId, key: string, type: FieldType) {
    const path = `fields.${key}`;
    const cursor = this.contacts.find({ workspaceId: ws, [path]: { $exists: true } }, { [path]: 1 }).lean().cursor({ batchSize: 1000 });
    let ops: Parameters<typeof this.contacts.bulkWrite>[0] = [];
    for await (const c of cursor) {
      const plain = plainFields({ [key]: (c.fields as Record<string, unknown>)?.[key] })[key] ?? "";
      const value = storeValue(plain, type);
      ops.push({ updateOne: { filter: { _id: c._id }, update: value === undefined ? { $unset: { [path]: 1 } } : { $set: { [path]: value } } } });
      if (ops.length >= 1000) {
        await this.contacts.bulkWrite(ops, { ordered: false });
        ops = [];
      }
    }
    if (ops.length) await this.contacts.bulkWrite(ops, { ordered: false });
  }
}
