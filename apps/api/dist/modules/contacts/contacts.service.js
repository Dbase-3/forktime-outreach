"use strict";
// Contacts at scale: filtering, sorting and paging in MongoDB (roadmap target:
// 100k contacts page in under 300 ms). Blanks sort last whichever way, using
// the index for the non-blank part. One contact per number (E.164).
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContactsService = void 0;
exports.contactOut = contactOut;
const common_1 = require("@nestjs/common");
const mongoose_1 = require("@nestjs/mongoose");
const contacts_table_1 = require("@outreach/core/contacts-table");
const phone_1 = require("@outreach/core/phone");
const mongoose_2 = require("mongoose");
const errors_1 = require("../../common/errors");
const versioned_1 = require("../../common/versioned");
const workspace_data_1 = require("../../common/workspace-data");
const mongo_filter_1 = require("./mongo-filter");
const typed_fields_1 = require("./typed-fields");
function contactOut(c) {
    return {
        id: String(c._id),
        name: c.name,
        phone: c.phone,
        phoneE164: c.phoneE164 ?? null,
        email: c.email ?? undefined,
        groups: c.groups ?? [],
        fields: (0, typed_fields_1.plainFields)(c.fields),
        sourceId: c.sourceId ?? undefined,
        createdAt: (c.createdAt ?? new Date()).toISOString(),
        lastCallAt: c.lastCallAt ? c.lastCallAt.toISOString() : null,
        lastOutcome: c.lastOutcome ?? null,
        version: c.version,
    };
}
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
let ContactsService = class ContactsService {
    contacts;
    data;
    constructor(contacts, data) {
        this.contacts = contacts;
        this.data = data;
    }
    /** The MongoDB filter for a table query (search, list, rules), for this workspace's live contacts. */
    async filterFor(ws, q, defs) {
        const [fieldDefs, settings] = await Promise.all([defs ?? this.data.defs(ws), this.data.settings(ws)]);
        const types = new Map((0, contacts_table_1.allColumns)(fieldDefs).map((d) => [d.key, d.type]));
        const and = [{ workspaceId: ws, deletedAt: null }];
        if (q.list)
            and.push({ groups: q.list });
        const search = q.search.trim();
        if (search) {
            const re = new RegExp(esc(search), "i");
            const digits = search.replace(/\D/g, "");
            and.push({ $or: [{ name: re }, { phone: re }, { email: re }, ...(digits.length >= 3 ? [{ phoneE164: new RegExp(esc(digits)) }] : [])] });
        }
        if (q.filter.rules.length)
            and.push((0, mongo_filter_1.groupQuery)(q.filter, (k) => types.get(k) ?? "text", { timezone: settings.timezone }));
        return and.length === 1 ? and[0] : { $and: and };
    }
    async query(ws, q) {
        const filter = await this.filterFor(ws, q);
        const total = await this.contacts.countDocuments(filter);
        const skip = (q.page - 1) * q.pageSize;
        let rows;
        if (!q.sort) {
            rows = await this.contacts.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(q.pageSize).lean();
        }
        else {
            // Blanks last either way: page through the filled-in ones (index order), then the blanks.
            const path = (0, mongo_filter_1.pathOf)(q.sort.key);
            const dir = q.sort.dir === "asc" ? 1 : -1;
            const filled = { $and: [filter, { [path]: { $nin: [null, ""], $exists: true } }] };
            const blank = { $and: [filter, { $or: [{ [path]: { $in: [null, ""] } }, { [path]: { $exists: false } }] }] };
            // Text sorts ignore case (a collation, which can't use the index); numbers, dates and yes/no use the index.
            const sortType = (0, contacts_table_1.allColumns)(await this.data.defs(ws)).find((d) => d.key === q.sort?.key)?.type ?? "text";
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
    async get(ws, id) {
        const c = await this.contacts.findOne({ _id: id, workspaceId: ws, deletedAt: null }).lean();
        if (!c)
            throw (0, errors_1.notFound)("That contact");
        return contactOut(c);
    }
    async byIds(ws, ids) {
        const valid = ids.filter((x) => mongoose_2.Types.ObjectId.isValid(x)).map((x) => new mongoose_2.Types.ObjectId(x));
        return (await this.contacts.find({ _id: { $in: valid }, workspaceId: ws }).lean()).map(contactOut);
    }
    async create(ws, input) {
        const [defs, settings] = await Promise.all([this.data.defs(ws), this.data.settings(ws)]);
        const phoneE164 = (0, phone_1.toE164)(input.phone, (0, phone_1.countryOfZone)(settings.timezone));
        if (phoneE164) {
            const existing = await this.contacts.findOne({ workspaceId: ws, phoneE164 }).lean();
            if (existing)
                throw (0, errors_1.conflict)(`${existing.name || "A contact"} already has that number.`, { contactId: String(existing._id) });
        }
        const doc = await this.contacts.create({ workspaceId: ws, name: input.name, phone: input.phone, phoneE164, email: input.email || undefined, groups: input.groups, fields: (0, typed_fields_1.storeFields)(input.fields, defs) });
        return contactOut(doc.toObject());
    }
    async save(ws, id, version, patch) {
        const [defs, settings] = await Promise.all([this.data.defs(ws), this.data.settings(ws)]);
        const set = {};
        if (patch.name !== undefined)
            set.name = patch.name;
        if (patch.email !== undefined)
            set.email = patch.email || undefined;
        if (patch.groups !== undefined)
            set.groups = patch.groups;
        if (patch.fields !== undefined)
            set.fields = (0, typed_fields_1.storeFields)(patch.fields, defs);
        if (patch.phone !== undefined) {
            set.phone = patch.phone;
            set.phoneE164 = (0, phone_1.toE164)(patch.phone, (0, phone_1.countryOfZone)(settings.timezone));
        }
        try {
            return contactOut(await (0, versioned_1.saveVersioned)(this.contacts, { _id: id, workspaceId: ws }, version, { $set: set }, contactOut, "That contact"));
        }
        catch (err) {
            if (err.code === 11000)
                throw (0, errors_1.conflict)("Another contact already has that number.");
            throw err;
        }
    }
    /** Soft delete; the number is freed so the person can be added again. */
    async remove(ws, filter) {
        const res = await this.contacts.updateMany({ ...filter, workspaceId: ws, deletedAt: null }, { $set: { deletedAt: new Date(), phoneE164: null } });
        return { deleted: res.modifiedCount };
    }
    async setList(ws, filter, list, add) {
        const res = await this.contacts.updateMany({ ...filter, workspaceId: ws, deletedAt: null }, add ? { $addToSet: { groups: list } } : { $pull: { groups: list } });
        return { changed: res.modifiedCount };
    }
    async lists(ws) {
        return (await this.contacts.distinct("groups", { workspaceId: ws, deletedAt: null })).filter(Boolean).sort();
    }
    /** Every contact matching a filter, a batch at a time (exports, audiences). */
    cursor(filter) {
        return this.contacts.find(filter).sort({ _id: 1 }).lean().cursor({ batchSize: 1000 });
    }
};
exports.ContactsService = ContactsService;
exports.ContactsService = ContactsService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, mongoose_1.InjectModel)("Contact")),
    __metadata("design:paramtypes", [Object, workspace_data_1.WorkspaceData])
], ContactsService);
//# sourceMappingURL=contacts.service.js.map