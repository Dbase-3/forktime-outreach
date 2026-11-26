"use strict";
// The knowledge library. Web documents are read by a job (safe-fetch: public
// addresses only, every redirect re-checked, size and time limits, ≤20 pages);
// text and files are stored as sent (web pages and XML keep only their words).
// A document an agent uses can't be deleted.
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
exports.KnowledgeController = void 0;
exports.readWeb = readWeb;
const common_1 = require("@nestjs/common");
const mongoose_1 = require("@nestjs/mongoose");
const knowledge_1 = require("@outreach/core/knowledge");
const schemas_1 = require("@outreach/core/schemas");
const mongoose_2 = require("mongoose");
const zod_1 = require("zod");
const decorators_1 = require("../../common/decorators");
const errors_1 = require("../../common/errors");
const ids_1 = require("../../common/ids");
const safe_fetch_1 = require("../../common/safe-fetch");
const serialize_1 = require("../../common/serialize");
const versioned_1 = require("../../common/versioned");
const zod_2 = require("../../common/zod");
const jobs_service_1 = require("../jobs/jobs.service");
const MAX_PAGES = 20;
const MAX_TEXT = 400_000;
const get = (url) => (0, safe_fetch_1.safeFetchText)(url, { timeoutMs: 10_000, maxBytes: 2 * 1024 * 1024 });
/** Reads a page, a sitemap (following an index) or a site's linked pages into text. */
async function readWeb(url, mode) {
    if (mode === "url") {
        const { title, text } = (0, knowledge_1.htmlToText)(await get(url));
        if (!text)
            throw new safe_fetch_1.FetchProblem("That page has no readable text.");
        return { title: title || new URL(url).hostname, text: text.slice(0, MAX_TEXT), pages: 1 };
    }
    let pages;
    let title;
    if (mode === "sitemap") {
        const xml = await get(url);
        if ((0, knowledge_1.isSitemapIndex)(xml)) {
            const lists = await Promise.allSettled((0, knowledge_1.sitemapUrls)(xml).slice(0, 3).map(async (child) => (0, knowledge_1.sitemapUrls)(await get(child))));
            pages = [...new Set(lists.flatMap((r) => (r.status === "fulfilled" ? r.value : [])))].slice(0, MAX_PAGES);
        }
        else
            pages = (0, knowledge_1.sitemapUrls)(xml).slice(0, MAX_PAGES);
        title = `${new URL(url).hostname} (sitemap)`;
    }
    else {
        const home = await get(url);
        pages = [url, ...(0, knowledge_1.sameSiteLinks)(home, url).filter((u) => u !== url)].slice(0, MAX_PAGES);
        title = (0, knowledge_1.htmlToText)(home).title || new URL(url).hostname;
    }
    if (!pages.length)
        throw new safe_fetch_1.FetchProblem("No pages found there.");
    const read = [];
    for (let i = 0; i < pages.length; i += 4) {
        const batch = await Promise.allSettled(pages.slice(i, i + 4).map(async (u) => ({ url: u, ...(0, knowledge_1.htmlToText)(await get(u)) })));
        for (const r of batch)
            if (r.status === "fulfilled" && r.value.text)
                read.push(r.value);
    }
    if (!read.length)
        throw new safe_fetch_1.FetchProblem("None of those pages could be read.");
    return { title, text: read.map((p) => `## ${p.title || p.url}\n${p.url}\n\n${p.text}`).join("\n\n").slice(0, MAX_TEXT), pages: read.length };
}
let KnowledgeController = class KnowledgeController {
    docs;
    agents;
    jobs;
    constructor(docs, agents, jobs) {
        this.docs = docs;
        this.agents = agents;
        this.jobs = jobs;
    }
    onModuleInit() {
        this.jobs.register("ingest-knowledge", async ({ id }) => {
            const doc = await this.docs.findById(id).lean();
            if (!doc || doc.deletedAt || !doc.source)
                return;
            try {
                const out = await readWeb(doc.source, doc.kind);
                await this.docs.updateOne({ _id: doc._id }, { $set: { status: "ready", content: out.text, sizeBytes: Buffer.byteLength(out.text), pages: out.pages, error: null, ...(doc.name === doc.source ? { name: out.title } : {}) }, $inc: { version: 1 } });
            }
            catch (err) {
                const message = err instanceof safe_fetch_1.FetchProblem ? err.message : "That address couldn't be read.";
                await this.docs.updateOne({ _id: doc._id }, { $set: { status: "failed", error: message }, $inc: { version: 1 } });
            }
        });
    }
    async list(ctx) {
        return (await this.docs.find({ workspaceId: ctx.workspaceId, deletedAt: null }, { content: 0 }).sort({ updatedAt: -1 }).lean()).map((d) => (0, serialize_1.knowledgeOut)(d));
    }
    async get(ctx, id) {
        const d = await this.docs.findOne({ _id: (0, ids_1.oid)(id, "That document"), workspaceId: ctx.workspaceId, deletedAt: null }).lean();
        if (!d)
            throw (0, errors_1.notFound)("That document");
        return (0, serialize_1.knowledgeOut)(d, true);
    }
    async add(ctx, body) {
        const input = (0, zod_2.parse)(schemas_1.KnowledgeInputSchema, body);
        const ws = ctx.workspaceId;
        let doc;
        if (input.kind === "text" || input.kind === "file") {
            const content = input.kind === "file" && /\.(html?|xml)$/i.test(input.name) ? (0, knowledge_1.htmlToText)(input.content).text : input.content;
            doc = await this.docs.create({ workspaceId: ws, name: input.name, kind: input.kind, source: input.kind === "file" ? input.name : undefined, content, sizeBytes: Buffer.byteLength(content), status: "ready", availableToAll: input.availableToAll });
        }
        else {
            doc = await this.docs.create({ workspaceId: ws, name: input.name || input.source, kind: input.kind, source: input.source, status: "reading", availableToAll: input.availableToAll, autoRefresh: true });
        }
        if (input.attachTo && mongoose_2.Types.ObjectId.isValid(input.attachTo)) {
            await this.agents.updateOne({ _id: new mongoose_2.Types.ObjectId(input.attachTo), workspaceId: ws, deletedAt: null }, { $addToSet: { "draft.knowledgeIds": String(doc._id) }, $inc: { version: 1 } });
        }
        if (doc.status === "reading")
            await this.jobs.enqueue("ingest-knowledge", { id: String(doc._id) });
        const fresh = await this.docs.findById(doc._id).lean();
        return (0, serialize_1.knowledgeOut)(fresh);
    }
    async refresh(ctx, id) {
        const d = await this.docs.findOneAndUpdate({ _id: (0, ids_1.oid)(id, "That document"), workspaceId: ctx.workspaceId, deletedAt: null, kind: { $in: ["url", "sitemap", "site"] } }, { $set: { status: "reading", error: null }, $inc: { version: 1 } }, { new: true }).lean();
        if (!d)
            throw (0, errors_1.notFound)("That web document");
        await this.jobs.enqueue("ingest-knowledge", { id: String(d._id) });
        return (0, serialize_1.knowledgeOut)((await this.docs.findById(d._id).lean()));
    }
    async save(ctx, id, body) {
        const { version, ...set } = (0, zod_2.parse)(zod_1.z.object({ version: zod_1.z.number().int(), name: zod_1.z.string().min(1).max(200).optional(), availableToAll: zod_1.z.boolean().optional(), autoRefresh: zod_1.z.boolean().optional(), content: zod_1.z.string().max(400_000).optional() }), body);
        const extra = set.content !== undefined ? { sizeBytes: Buffer.byteLength(set.content) } : {};
        return (0, serialize_1.knowledgeOut)(await (0, versioned_1.saveVersioned)(this.docs, { _id: (0, ids_1.oid)(id, "That document"), workspaceId: ctx.workspaceId }, version, { $set: { ...set, ...extra } }, (d) => (0, serialize_1.knowledgeOut)(d), "That document"), true);
    }
    async remove(ctx, id) {
        const _id = (0, ids_1.oid)(id, "That document");
        const users = await this.agents.find({ workspaceId: ctx.workspaceId, deletedAt: null, "draft.knowledgeIds": id }).lean();
        if (users.length)
            throw (0, errors_1.conflict)(`${users.map((a) => a.draft.name).join(", ")} ${users.length === 1 ? "uses" : "use"} it. Detach it first.`);
        const res = await this.docs.updateOne({ _id, workspaceId: ctx.workspaceId, deletedAt: null }, { $set: { deletedAt: new Date(), content: "" } });
        if (!res.matchedCount)
            throw (0, errors_1.notFound)("That document");
        return { deleted: true };
    }
};
exports.KnowledgeController = KnowledgeController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, decorators_1.Ctx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], KnowledgeController.prototype, "list", null);
__decorate([
    (0, common_1.Get)(":id"),
    __param(0, (0, decorators_1.Ctx)()),
    __param(1, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], KnowledgeController.prototype, "get", null);
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, decorators_1.Ctx)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], KnowledgeController.prototype, "add", null);
__decorate([
    (0, common_1.Post)(":id/refresh"),
    __param(0, (0, decorators_1.Ctx)()),
    __param(1, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], KnowledgeController.prototype, "refresh", null);
__decorate([
    (0, common_1.Patch)(":id"),
    __param(0, (0, decorators_1.Ctx)()),
    __param(1, (0, common_1.Param)("id")),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], KnowledgeController.prototype, "save", null);
__decorate([
    (0, common_1.Delete)(":id"),
    __param(0, (0, decorators_1.Ctx)()),
    __param(1, (0, common_1.Param)("id")),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], KnowledgeController.prototype, "remove", null);
exports.KnowledgeController = KnowledgeController = __decorate([
    (0, common_1.Controller)("w/:ws/knowledge"),
    __param(0, (0, mongoose_1.InjectModel)("Knowledge")),
    __param(1, (0, mongoose_1.InjectModel)("Agent")),
    __metadata("design:paramtypes", [Object, Object, jobs_service_1.JobsService])
], KnowledgeController);
//# sourceMappingURL=knowledge.controller.js.map