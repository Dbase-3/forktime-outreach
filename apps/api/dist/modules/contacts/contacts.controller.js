"use strict";
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
exports.ContactsController = void 0;
const common_1 = require("@nestjs/common");
const contacts_table_1 = require("@outreach/core/contacts-table");
const schemas_1 = require("@outreach/core/schemas");
const mongoose_1 = require("mongoose");
const zod_1 = require("zod");
const decorators_1 = require("../../common/decorators");
const ids_1 = require("../../common/ids");
const workspace_data_1 = require("../../common/workspace-data");
const zod_2 = require("../../common/zod");
const contacts_service_1 = require("./contacts.service");
const typed_fields_1 = require("./typed-fields");
const Target = zod_1.z.union([zod_1.z.object({ ids: zod_1.z.array(zod_1.z.string().max(64)).min(1).max(5000) }), zod_1.z.object({ query: schemas_1.ContactQuerySchema.pick({ search: true, list: true, filter: true }) })]);
const cell = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
let ContactsController = class ContactsController {
    service;
    data;
    constructor(service, data) {
        this.service = service;
        this.data = data;
    }
    query(ctx, body) {
        return this.service.query(ctx.workspaceId, (0, zod_2.parse)(schemas_1.ContactQuerySchema, body ?? {}));
    }
    lists(ctx) {
        return this.service.lists(ctx.workspaceId);
    }
    /** A few contacts, for pickers like the agent preview's "Calling …". */
    async sample(ctx, limit) {
        const out = await this.service.query(ctx.workspaceId, (0, zod_2.parse)(schemas_1.ContactQuerySchema, { pageSize: Math.min(100, Number(limit) || 30) }));
        return out.rows;
    }
    byIds(ctx, body) {
        return this.service.byIds(ctx.workspaceId, (0, zod_2.parse)(zod_1.z.object({ ids: zod_1.z.array(zod_1.z.string().max(64)).max(500) }), body).ids);
    }
    create(ctx, body) {
        return this.service.create(ctx.workspaceId, (0, zod_2.parse)(schemas_1.ContactInputSchema, body));
    }
    get(ctx, id) {
        return this.service.get(ctx.workspaceId, (0, ids_1.oid)(id, "That contact"));
    }
    save(ctx, id, body) {
        const { version, ...patch } = (0, zod_2.parse)(schemas_1.ContactInputSchema.partial().extend({ version: zod_1.z.number().int() }), body);
        return this.service.save(ctx.workspaceId, (0, ids_1.oid)(id, "That contact"), version, patch);
    }
    remove(ctx, id) {
        return this.service.remove(ctx.workspaceId, { _id: (0, ids_1.oid)(id, "That contact") });
    }
    /** Delete, or add to / remove from a list, for picked ids or everyone matching a query. */
    async bulk(ctx, body) {
        const ws = ctx.workspaceId;
        const input = (0, zod_2.parse)(zod_1.z.object({ action: zod_1.z.enum(["delete", "add_list", "remove_list"]), list: zod_1.z.string().max(80).optional(), target: Target }), body);
        const filter = "ids" in input.target ? { _id: { $in: input.target.ids.filter((x) => mongoose_1.Types.ObjectId.isValid(x)).map((x) => new mongoose_1.Types.ObjectId(x)) } } : await this.service.filterFor(ws, input.target.query);
        if (input.action === "delete")
            return this.service.remove(ws, filter);
        if (!input.list?.trim())
            return { changed: 0 };
        return this.service.setList(ws, filter, input.list.trim(), input.action === "add_list");
    }
    /** CSV of everyone matching the query, streamed in batches. */
    async export(ctx, body, res) {
        const ws = ctx.workspaceId;
        const q = (0, zod_2.parse)(schemas_1.ContactQuerySchema.pick({ search: true, list: true, filter: true }), body ?? {});
        const defs = await this.data.defs(ws);
        const columns = (0, contacts_table_1.allColumns)(defs);
        res.setHeader("content-type", "text/csv; charset=utf-8");
        res.setHeader("content-disposition", 'attachment; filename="contacts.csv"');
        res.write(columns.map((c) => cell(c.label)).join(",") + "\n");
        for await (const c of this.service.cursor(await this.service.filterFor(ws, q, defs))) {
            const out = (0, contacts_service_1.contactOut)(c);
            const values = { ...(0, typed_fields_1.plainFields)(c.fields), name: out.name, phone: out.phone, email: out.email ?? "", lists: out.groups.join(", "), last_call: out.lastCallAt?.slice(0, 10) ?? "", last_outcome: out.lastOutcome ?? "", created: out.createdAt.slice(0, 10) };
            res.write(columns.map((col) => cell(values[col.key] ?? "")).join(",") + "\n");
        }
        res.end();
    }
};
exports.ContactsController = ContactsController;
__decorate([
    (0, common_1.Post)("query"),
    __param(0, (0, decorators_1.Ctx)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], ContactsController.prototype, "query", null);
__decorate([
    (0, common_1.Get)("lists"),
    __param(0, (0, decorators_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], ContactsController.prototype, "lists", null);
__decorate([
    (0, common_1.Get)("sample"),
    __param(0, (0, decorators_1.Ctx)()),
    __param(1, (0, common_1.Query)("limit")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], ContactsController.prototype, "sample", null);
__decorate([
    (0, common_1.Post)("by-ids"),
    __param(0, (0, decorators_1.Ctx)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], ContactsController.prototype, "byIds", null);
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, decorators_1.Ctx)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], ContactsController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(":id"),
    __param(0, (0, decorators_1.Ctx)()),
    __param(1, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], ContactsController.prototype, "get", null);
__decorate([
    (0, common_1.Patch)(":id"),
    __param(0, (0, decorators_1.Ctx)()),
    __param(1, (0, common_1.Param)("id")),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], ContactsController.prototype, "save", null);
__decorate([
    (0, common_1.Delete)(":id"),
    __param(0, (0, decorators_1.Ctx)()),
    __param(1, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], ContactsController.prototype, "remove", null);
__decorate([
    (0, common_1.Post)("bulk"),
    __param(0, (0, decorators_1.Ctx)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ContactsController.prototype, "bulk", null);
__decorate([
    (0, common_1.Post)("export"),
    __param(0, (0, decorators_1.Ctx)()),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], ContactsController.prototype, "export", null);
exports.ContactsController = ContactsController = __decorate([
    (0, common_1.Controller)("w/:ws/contacts"),
    __metadata("design:paramtypes", [contacts_service_1.ContactsService, workspace_data_1.WorkspaceData])
], ContactsController);
//# sourceMappingURL=contacts.controller.js.map