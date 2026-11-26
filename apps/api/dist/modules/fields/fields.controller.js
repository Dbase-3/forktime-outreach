"use strict";
// Contact fields. A field in use (campaign rules, triggers, saved answers,
// agent decisions or lines; @outreach/core field-usage) can't be removed, and
// changing its type needs `confirm` (audit B23). Changing the type converts
// the stored values so filters keep working.
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
exports.FieldsController = void 0;
const common_1 = require("@nestjs/common");
const mongoose_1 = require("@nestjs/mongoose");
const field_usage_1 = require("@outreach/core/field-usage");
const schemas_1 = require("@outreach/core/schemas");
const zod_1 = require("zod");
const decorators_1 = require("../../common/decorators");
const errors_1 = require("../../common/errors");
const serialize_1 = require("../../common/serialize");
const workspace_data_1 = require("../../common/workspace-data");
const zod_2 = require("../../common/zod");
const typed_fields_1 = require("../contacts/typed-fields");
let FieldsController = class FieldsController {
    fields;
    contacts;
    data;
    constructor(fields, contacts, data) {
        this.fields = fields;
        this.contacts = contacts;
        this.data = data;
    }
    async list(ctx) {
        return (await this.fields.find({ workspaceId: ctx.workspaceId }).sort({ createdAt: 1 }).lean()).map(serialize_1.fieldOut);
    }
    async add(ctx, body) {
        const def = (0, zod_2.parse)(schemas_1.FieldDefSchema, body);
        if (["name", "phone", "email", "lists", "created", "last_call", "last_outcome"].includes(def.key))
            throw (0, errors_1.conflict)(`“${def.key}” is a built-in column. Pick another name.`);
        const doc = await this.fields.create({ workspaceId: ctx.workspaceId, ...def });
        return (0, serialize_1.fieldOut)(doc.toObject());
    }
    async edit(ctx, key, body) {
        const patch = (0, zod_2.parse)(zod_1.z.object({ label: zod_1.z.string().min(1).max(100).optional(), type: schemas_1.FieldDefSchema.shape.type.optional(), choices: zod_1.z.array(zod_1.z.string().max(100)).max(50).optional(), confirm: zod_1.z.boolean().default(false) }), body);
        const ws = ctx.workspaceId;
        const def = await this.fields.findOne({ workspaceId: ws, key }).lean();
        if (!def)
            throw (0, errors_1.notFound)("That field");
        if (patch.type && patch.type !== def.type) {
            const uses = await this.usesOf(ws, key);
            if (uses.length && !patch.confirm)
                throw (0, errors_1.conflict)("Rules on this field may stop matching.", { uses });
            await this.convert(ws, key, patch.type);
        }
        const { confirm: _c, ...set } = patch;
        const next = await this.fields.findOneAndUpdate({ workspaceId: ws, key }, { $set: set }, { new: true }).lean();
        return (0, serialize_1.fieldOut)(next);
    }
    async remove(ctx, key) {
        const ws = ctx.workspaceId;
        const uses = await this.usesOf(ws, key);
        if (uses.length)
            throw (0, errors_1.conflict)("This field is in use. Change those first.", { uses });
        const res = await this.fields.deleteOne({ workspaceId: ws, key });
        if (!res.deletedCount)
            throw (0, errors_1.notFound)("That field");
        return { removed: true }; // values stay on contacts, hidden, in case it's added back
    }
    async usesOf(ws, key) {
        const [flows, campaigns] = await Promise.all([this.data.flows(ws), this.data.campaignsOf(ws)]);
        return (0, field_usage_1.fieldUsage)({ flows, campaigns }, key);
    }
    /** Re-stores every value of the field as the new type, in batches. */
    async convert(ws, key, type) {
        const path = `fields.${key}`;
        const cursor = this.contacts.find({ workspaceId: ws, [path]: { $exists: true } }, { [path]: 1 }).lean().cursor({ batchSize: 1000 });
        let ops = [];
        for await (const c of cursor) {
            const plain = (0, typed_fields_1.plainFields)({ [key]: c.fields?.[key] })[key] ?? "";
            const value = (0, typed_fields_1.storeValue)(plain, type);
            ops.push({ updateOne: { filter: { _id: c._id }, update: value === undefined ? { $unset: { [path]: 1 } } : { $set: { [path]: value } } } });
            if (ops.length >= 1000) {
                await this.contacts.bulkWrite(ops, { ordered: false });
                ops = [];
            }
        }
        if (ops.length)
            await this.contacts.bulkWrite(ops, { ordered: false });
    }
};
exports.FieldsController = FieldsController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, decorators_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], FieldsController.prototype, "list", null);
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, decorators_1.Ctx)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], FieldsController.prototype, "add", null);
__decorate([
    (0, common_1.Patch)(":key"),
    __param(0, (0, decorators_1.Ctx)()),
    __param(1, (0, common_1.Param)("key")),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], FieldsController.prototype, "edit", null);
__decorate([
    (0, common_1.Delete)(":key"),
    __param(0, (0, decorators_1.Ctx)()),
    __param(1, (0, common_1.Param)("key")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], FieldsController.prototype, "remove", null);
exports.FieldsController = FieldsController = __decorate([
    (0, common_1.Controller)("w/:ws/fields"),
    __param(0, (0, mongoose_1.InjectModel)("FieldDef")),
    __param(1, (0, mongoose_1.InjectModel)("Contact")),
    __metadata("design:paramtypes", [Object, Object, workspace_data_1.WorkspaceData])
], FieldsController);
//# sourceMappingURL=fields.controller.js.map