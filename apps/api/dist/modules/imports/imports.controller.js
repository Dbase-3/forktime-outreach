"use strict";
// CSV import as a job (roadmap Phase 1): the file is stored with its column
// mapping, then imported 1,000 rows at a time with core planImport (dates as
// YYYY-MM-DD read the way each column shows, one contact per number, checked
// against contacts already here). Progress is on the import document.
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
exports.ImportsController = void 0;
const common_1 = require("@nestjs/common");
const mongoose_1 = require("@nestjs/mongoose");
const csv_1 = require("@outreach/core/csv");
const contacts_table_1 = require("@outreach/core/contacts-table");
const phone_1 = require("@outreach/core/phone");
const zod_1 = require("zod");
const decorators_1 = require("../../common/decorators");
const errors_1 = require("../../common/errors");
const ids_1 = require("../../common/ids");
const workspace_data_1 = require("../../common/workspace-data");
const zod_2 = require("../../common/zod");
const typed_fields_1 = require("../contacts/typed-fields");
const jobs_service_1 = require("../jobs/jobs.service");
const Column = zod_1.z.object({ index: zod_1.z.number().int().min(0).max(500), name: zod_1.z.string().max(200), label: zod_1.z.string().max(200).default(""), samples: zod_1.z.array(zod_1.z.string()).max(10).default([]), type: zod_1.z.enum(["text", "number", "date", "yesno", "choice", "phone", "email"]), target: zod_1.z.string().max(80) });
const Input = zod_1.z.object({ fileName: zod_1.z.string().max(200).default("import.csv"), csv: zod_1.z.string().min(1).max(15_000_000), columns: zod_1.z.array(Column).max(500), list: zod_1.z.string().max(80).default("") });
const importOut = (i) => ({ id: String(i._id), status: i.status, fileName: i.fileName, total: i.total, done: i.done, created: i.created, duplicates: i.duplicates, skipped: i.skipped, error: i.error ?? null });
let ImportsController = class ImportsController {
    imports;
    contacts;
    fields;
    sources;
    jobs;
    data;
    constructor(imports, contacts, fields, sources, jobs, data) {
        this.imports = imports;
        this.contacts = contacts;
        this.fields = fields;
        this.sources = sources;
        this.jobs = jobs;
        this.data = data;
    }
    onModuleInit() {
        this.jobs.register("import-contacts", ({ id }) => this.process(id));
    }
    async start(ctx, body) {
        const input = (0, zod_2.parse)(Input, body);
        const doc = await this.imports.create({ workspaceId: ctx.workspaceId, fileName: input.fileName, csv: input.csv, columns: input.columns, list: input.list, createdBy: ctx.userId });
        await this.jobs.enqueue("import-contacts", { id: String(doc._id) }, String(doc._id));
        return importOut((await this.imports.findById(doc._id).lean()));
    }
    async get(ctx, id) {
        const i = await this.imports.findOne({ _id: (0, ids_1.oid)(id, "That import"), workspaceId: ctx.workspaceId }).lean();
        if (!i)
            throw (0, errors_1.notFound)("That import");
        return importOut(i);
    }
    async process(id) {
        const job = await this.imports.findOneAndUpdate({ _id: (0, ids_1.oid)(id), status: { $in: ["queued", "running"] } }, { $set: { status: "running" } }, { new: true }).lean();
        if (!job)
            return;
        const ws = job.workspaceId;
        try {
            const [defs, settings] = await Promise.all([this.data.defs(ws), this.data.settings(ws)]);
            const country = (0, phone_1.countryOfZone)(settings.timezone);
            const rows = (0, csv_1.parseCsv)(job.csv).slice(1); // the first row is the header
            const columns = job.columns;
            const source = await this.sources.create({ workspaceId: ws, kind: "csv", name: job.fileName, list: job.list, fieldKeys: columns.filter((c) => c.target.startsWith("field:")).map((c) => c.target.slice(6)), rows: 0, lastSyncAt: new Date(), status: "syncing" });
            await this.imports.updateOne({ _id: job._id }, { $set: { total: rows.length, sourceId: String(source._id) } });
            const known = [...defs];
            let created = 0;
            let duplicates = 0;
            let skipped = 0;
            for (let at = 0; at < rows.length; at += 1000) {
                const batch = rows.slice(at, at + 1000);
                const phoneCol = columns.find((c) => c.target === "phone")?.index ?? -1;
                const e164s = batch.map((r) => (0, phone_1.toE164)(r[phoneCol] ?? "", country)).filter((x) => Boolean(x));
                const existing = (await this.contacts.find({ workspaceId: ws, phoneE164: { $in: e164s } }, { phone: 1 }).lean()).map((c) => ({ phone: c.phone }));
                const plan = (0, contacts_table_1.planImport)(columns, batch, job.list, known, String(source._id), existing, country);
                for (const f of plan.newFields) {
                    await this.fields.updateOne({ workspaceId: ws, key: f.key }, { $setOnInsert: { label: f.label, type: f.type, source: String(source._id) } }, { upsert: true });
                    known.push(f);
                }
                duplicates += plan.duplicates;
                skipped += plan.skipped;
                const docs = plan.contacts.map((c) => ({ workspaceId: ws, name: c.name, phone: c.phone, phoneE164: (0, phone_1.toE164)(c.phone, country), email: c.email, groups: c.groups, fields: (0, typed_fields_1.storeFields)(c.fields, known), sourceId: String(source._id) }));
                try {
                    const res = await this.contacts.insertMany(docs, { ordered: false, lean: true });
                    created += res.length;
                }
                catch (err) {
                    // Someone else added a number meanwhile: count those as duplicates, keep the rest.
                    const inserted = err.insertedDocs?.length ?? 0;
                    created += inserted;
                    duplicates += docs.length - inserted;
                }
                await this.imports.updateOne({ _id: job._id }, { $set: { done: Math.min(rows.length, at + batch.length), created, duplicates, skipped } });
            }
            await this.sources.updateOne({ _id: source._id }, { $set: { rows: created, status: "synced", lastSyncAt: new Date() } });
            await this.imports.updateOne({ _id: job._id }, { $set: { status: "done", csv: "" } });
        }
        catch (err) {
            await this.imports.updateOne({ _id: job._id }, { $set: { status: "failed", error: err instanceof Error ? err.message : "The import failed." } });
            throw err;
        }
    }
};
exports.ImportsController = ImportsController;
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, decorators_1.Ctx)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ImportsController.prototype, "start", null);
__decorate([
    (0, common_1.Get)(":id"),
    __param(0, (0, decorators_1.Ctx)()),
    __param(1, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], ImportsController.prototype, "get", null);
exports.ImportsController = ImportsController = __decorate([
    (0, common_1.Controller)("w/:ws/imports"),
    __param(0, (0, mongoose_1.InjectModel)("Import")),
    __param(1, (0, mongoose_1.InjectModel)("Contact")),
    __param(2, (0, mongoose_1.InjectModel)("FieldDef")),
    __param(3, (0, mongoose_1.InjectModel)("Source")),
    __metadata("design:paramtypes", [Object, Object, Object, Object, jobs_service_1.JobsService,
        workspace_data_1.WorkspaceData])
], ImportsController);
//# sourceMappingURL=imports.controller.js.map