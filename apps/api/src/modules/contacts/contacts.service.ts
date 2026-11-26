// Contacts at scale: filtering, sorting and paging in MongoDB (roadmap target:
// 100k contacts page in under 300 ms). Blanks sort last whichever way, using
// the index for the non-blank part. One contact per number (E.164).

import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { allColumns } from "@outreach/core/contacts-table";
import { countryOfZone, toE164 } from "@outreach/core/phone";
import type { ContactQuery } from "@outreach/core/schemas";
import type { Contact, FieldDef, FieldType } from "@outreach/core/types";
import { Types, type FilterQuery } from "mongoose";
import { conflict, notFound } from "../../common/errors";
import { saveVersioned } from "../../common/versioned";
import { WorkspaceData } from "../../common/workspace-data";
import type { M, Row } from "../../db/models";
import { groupQuery, pathOf } from "./mongo-filter";
import { plainFields, storeFields } from "./typed-fields";

export type ContactOut = Contact & { version: number; lastCallAt: string | null; lastOutcome: string | null; phoneE164: string | null };

export function contactOut(c: Row<"Contact">): ContactOut {
  return {
    id: String(c._id),
    name: c.name,
    phone: c.phone,
    phoneE164: c.phoneE164 ?? null,
    email: c.email ?? undefined,
    groups: c.groups ?? [],
    fields: plainFields(c.fields as Record<string, unknown>),
    sourceId: c.sourceId ?? undefined,
    createdAt: (c.createdAt ?? new Date()).toISOString(),
    lastCallAt: c.lastCallAt ? c.lastCallAt.toISOString() : null,
    lastOutcome: c.lastOutcome ?? null,
    version: c.version,
  };
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

@Injectable()
export class ContactsService {
  constructor(@InjectModel("Contact") private readonly contacts: M<"Contact">, private readonly data: WorkspaceData) {}

  /** The MongoDB filter for a table query (search, list, rules), for this workspace's live contacts. */
  async filterFor(ws: Types.ObjectId, q: Pick<ContactQuery, "search" | "list" | "filter">, defs?: FieldDef[]): Promise<FilterQuery<Row<"Contact">>> {
    const [fieldDefs, settings] = await Promise.all([defs ?? this.data.defs(ws), this.data.settings(ws)]);
    const types = new Map(allColumns(fieldDefs).map((d) => [d.key, d.type as FieldType]));
    const and: FilterQuery<Row<"Contact">>[] = [{ workspaceId: ws, deletedAt: null }];
    if (q.list) and.push({ groups: q.list });
    const search = q.search.trim();
    if (search) {
      const re = new RegExp(esc(search), "i");
      const digits = search.replace(/\D/g, "");
      and.push({ $or: [{ name: re }, { phone: re }, { email: re }, ...(digits.length >= 3 ? [{ phoneE164: new RegExp(esc(digits)) }] : [])] });
    }
    if (q.filter.rules.length) and.push(groupQuery(q.filter, (k) => types.get(k) ?? "text", { timezone: settings.timezone }) as FilterQuery<Row<"Contact">>);
    return and.length === 1 ? and[0] : { $and: and };
  }

  async query(ws: Types.ObjectId, q: ContactQuery) {
    const filter = await this.filterFor(ws, q);
    const total = await this.contacts.countDocuments(filter);
    const skip = (q.page - 1) * q.pageSize;
    let rows: Row<"Contact">[];
    if (!q.sort) {
      rows = await this.contacts.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(q.pageSize).lean();
    } else {
      // Blanks last either way: page through the filled-in ones (index order), then the blanks.
      const path = pathOf(q.sort.key);
      const dir = q.sort.dir === "asc" ? 1 : -1;
      const filled = { $and: [filter, { [path]: { $nin: [null, ""], $exists: true } }] } as FilterQuery<Row<"Contact">>;
      const blank = { $and: [filter, { $or: [{ [path]: { $in: [null, ""] } }, { [path]: { $exists: false } }] }] } as FilterQuery<Row<"Contact">>;
      // Text sorts ignore case (a collation, which can't use the index); numbers, dates and yes/no use the index.
      const sortType = allColumns(await this.data.defs(ws)).find((d) => d.key === q.sort?.key)?.type ?? "text";
      const textual = !["number", "date", "yesno"].includes(sortType) && !["createdAt", "lastCallAt"].includes(path);
      const find = this.contacts.find(filled).sort({ [path]: dir, _id: 1 }).skip(skip).limit(q.pageSize);
      rows = await (textual ? find.collation({ locale: "en", strength: 2, numericOrdering: true }) : find).lean();
      // Only the page where filled-in rows run out needs to know how many there are.
      if (rows.length < q.pageSize) {
        const filledCount = rows.length ? skip + rows.length : await this.contacts.countDocuments(filled);
        const blankSkip = Math.max(0, skip - filledCount);
        rows = rows.concat(await this.contacts.find(blank).sort({ _id: 1 }).skip(blankSkip).limit(q.pageSize - rows.length).lean());
      }
    }
    return { rows: rows.map(contactOut), total, page: q.page, pages: Math.max(1, Math.ceil(total / q.pageSize)) };
  }

  async get(ws: Types.ObjectId, id: Types.ObjectId) {
    const c = await this.contacts.findOne({ _id: id, workspaceId: ws, deletedAt: null }).lean();
    if (!c) throw notFound("That contact");
    return contactOut(c);
  }

  async byIds(ws: Types.ObjectId, ids: string[]) {
    const valid = ids.filter((x) => Types.ObjectId.isValid(x)).map((x) => new Types.ObjectId(x));
    return (await this.contacts.find({ _id: { $in: valid }, workspaceId: ws }).lean()).map(contactOut);
  }

  async create(ws: Types.ObjectId, input: { name: string; phone: string; email?: string; groups: string[]; fields: Record<string, string> }) {
    const [defs, settings] = await Promise.all([this.data.defs(ws), this.data.settings(ws)]);
    const phoneE164 = toE164(input.phone, countryOfZone(settings.timezone));
    if (phoneE164) {
      const existing = await this.contacts.findOne({ workspaceId: ws, phoneE164 }).lean();
      if (existing) throw conflict(`${existing.name || "A contact"} already has that number.`, { contactId: String(existing._id) });
    }
    const doc = await this.contacts.create({ workspaceId: ws, name: input.name, phone: input.phone, phoneE164, email: input.email || undefined, groups: input.groups, fields: storeFields(input.fields, defs) });
    return contactOut(doc.toObject());
  }

  async save(ws: Types.ObjectId, id: Types.ObjectId, version: number, patch: Partial<{ name: string; phone: string; email: string; groups: string[]; fields: Record<string, string> }>) {
    const [defs, settings] = await Promise.all([this.data.defs(ws), this.data.settings(ws)]);
    const set: Record<string, unknown> = {};
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.email !== undefined) set.email = patch.email || undefined;
    if (patch.groups !== undefined) set.groups = patch.groups;
    if (patch.fields !== undefined) set.fields = storeFields(patch.fields, defs);
    if (patch.phone !== undefined) {
      set.phone = patch.phone;
      set.phoneE164 = toE164(patch.phone, countryOfZone(settings.timezone));
    }
    try {
      return contactOut(await saveVersioned(this.contacts, { _id: id, workspaceId: ws }, version, { $set: set }, contactOut, "That contact"));
    } catch (err) {
      if ((err as { code?: number }).code === 11000) throw conflict("Another contact already has that number.");
      throw err;
    }
  }

  /** Soft delete; the number is freed so the person can be added again. */
  async remove(ws: Types.ObjectId, filter: FilterQuery<Row<"Contact">>) {
    const res = await this.contacts.updateMany({ ...filter, workspaceId: ws, deletedAt: null }, { $set: { deletedAt: new Date(), phoneE164: null } });
    return { deleted: res.modifiedCount };
  }

  async setList(ws: Types.ObjectId, filter: FilterQuery<Row<"Contact">>, list: string, add: boolean) {
    const res = await this.contacts.updateMany({ ...filter, workspaceId: ws, deletedAt: null }, add ? { $addToSet: { groups: list } } : { $pull: { groups: list } });
    return { changed: res.modifiedCount };
  }

  async lists(ws: Types.ObjectId): Promise<string[]> {
    return ((await this.contacts.distinct("groups", { workspaceId: ws, deletedAt: null })) as string[]).filter(Boolean).sort();
  }

  /** Every contact matching a filter, a batch at a time (exports, audiences). */
  cursor(filter: FilterQuery<Row<"Contact">>) {
    return this.contacts.find(filter).sort({ _id: 1 }).lean().cursor({ batchSize: 1000 });
  }
}
