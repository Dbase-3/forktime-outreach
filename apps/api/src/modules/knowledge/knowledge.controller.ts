// The knowledge library. Web documents are read by a job (safe-fetch: public
// addresses only, every redirect re-checked, size and time limits, ≤20 pages);
// uploaded files (PDF, Word .docx, text) are kept until a job has read them
// (read-file.ts), then deleted; pasted text is stored as sent.
// A document an agent uses can't be deleted.

import { Body, Controller, Delete, Get, Param, Patch, Post, UploadedFile, UseInterceptors, type OnModuleInit } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { InjectModel } from "@nestjs/mongoose";
import { htmlToText, isSitemapIndex, sameSiteLinks, sitemapUrls } from "@outreach/core/knowledge";
import { KnowledgeInputSchema } from "@outreach/core/schemas";
import { Types } from "mongoose";
import { z } from "zod";
import { Ctx } from "../../common/decorators";
import { conflict, notFound, unprocessable } from "../../common/errors";
import { oid } from "../../common/ids";
import { KnowledgeIndex } from "../../common/knowledge-index";
import type { RequestContext } from "../../common/request";
import { FetchProblem, safeFetchText } from "../../common/safe-fetch";
import { knowledgeOut } from "../../common/serialize";
import { saveVersioned } from "../../common/versioned";
import { parse } from "../../common/zod";
import type { M } from "../../db/models";
import { JobsService } from "../jobs/jobs.service";
import { FileProblem, UPLOADABLE, readFileText } from "./read-file";

const MAX_UPLOAD = 15 * 1024 * 1024;

const MAX_PAGES = 20;
const MAX_TEXT = 400_000;
const get = (url: string) => safeFetchText(url, { timeoutMs: 10_000, maxBytes: 2 * 1024 * 1024 });

/** Reads a page, a sitemap (following an index) or a site's linked pages into text. */
export async function readWeb(url: string, mode: "url" | "sitemap" | "site"): Promise<{ title: string; text: string; pages: number }> {
  if (mode === "url") {
    const { title, text } = htmlToText(await get(url));
    if (!text) throw new FetchProblem("That page has no readable text.");
    return { title: title || new URL(url).hostname, text: text.slice(0, MAX_TEXT), pages: 1 };
  }
  let pages: string[];
  let title: string;
  if (mode === "sitemap") {
    const xml = await get(url);
    if (isSitemapIndex(xml)) {
      const lists = await Promise.allSettled(sitemapUrls(xml).slice(0, 3).map(async (child) => sitemapUrls(await get(child))));
      pages = [...new Set(lists.flatMap((r) => (r.status === "fulfilled" ? r.value : [])))].slice(0, MAX_PAGES);
    } else pages = sitemapUrls(xml).slice(0, MAX_PAGES);
    title = `${new URL(url).hostname} (sitemap)`;
  } else {
    const home = await get(url);
    pages = [url, ...sameSiteLinks(home, url).filter((u) => u !== url)].slice(0, MAX_PAGES);
    title = htmlToText(home).title || new URL(url).hostname;
  }
  if (!pages.length) throw new FetchProblem("No pages found there.");
  const read: { url: string; title: string; text: string }[] = [];
  for (let i = 0; i < pages.length; i += 4) {
    const batch = await Promise.allSettled(pages.slice(i, i + 4).map(async (u) => ({ url: u, ...htmlToText(await get(u)) })));
    for (const r of batch) if (r.status === "fulfilled" && r.value.text) read.push(r.value);
  }
  if (!read.length) throw new FetchProblem("None of those pages could be read.");
  return { title, text: read.map((p) => `## ${p.title || p.url}\n${p.url}\n\n${p.text}`).join("\n\n").slice(0, MAX_TEXT), pages: read.length };
}

@Controller("w/:ws/knowledge")
export class KnowledgeController implements OnModuleInit {
  constructor(
    @InjectModel("Knowledge") private readonly docs: M<"Knowledge">,
    @InjectModel("Agent") private readonly agents: M<"Agent">,
    @InjectModel("Upload") private readonly uploads: M<"Upload">,
    private readonly jobs: JobsService,
    private readonly index: KnowledgeIndex,
  ) {}

  onModuleInit() {
    this.jobs.register("ingest-knowledge", async ({ id }) => {
      const doc = await this.docs.findById(id).lean();
      if (!doc || doc.deletedAt || !doc.source) return;
      try {
        const out = await readWeb(doc.source, doc.kind as "url" | "sitemap" | "site");
        await this.docs.updateOne({ _id: doc._id }, { $set: { status: "ready", content: out.text, sizeBytes: Buffer.byteLength(out.text), pages: out.pages, error: null, ...(doc.name === doc.source ? { name: out.title } : {}) }, $inc: { version: 1 } });
        await this.index.reindex(doc._id);
      } catch (err) {
        const message = err instanceof FetchProblem ? err.message : "That address couldn't be read.";
        await this.docs.updateOne({ _id: doc._id }, { $set: { status: "failed", error: message }, $inc: { version: 1 } });
      }
    });
    this.jobs.register("read-file", async ({ id }) => {
      const upload = await this.uploads.findOne({ docId: oid(id) }).lean();
      if (!upload) return;
      try {
        const raw = upload.data as unknown; // lean() gives the driver's Binary, not a Buffer
        const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from((raw as { buffer: Uint8Array }).buffer);
        const out = await readFileText(upload.name ?? "", bytes);
        await this.docs.updateOne({ _id: upload.docId, deletedAt: null }, { $set: { status: "ready", content: out.text, sizeBytes: Buffer.byteLength(out.text), pages: out.pages, error: null }, $inc: { version: 1 } });
        await this.index.reindex(upload.docId);
      } catch (err) {
        const message = err instanceof FileProblem ? err.message : "That file couldn't be read.";
        await this.docs.updateOne({ _id: upload.docId }, { $set: { status: "failed", error: message }, $inc: { version: 1 } });
      } finally {
        await this.uploads.deleteOne({ _id: upload._id });
      }
    });
  }

  /** The passages that answer a question: what an agent would find (all documents, or one agent's). */
  @Post("search")
  async search(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    const q = parse(z.object({ query: z.string().min(1).max(300), agentId: z.string().max(64).optional(), limit: z.number().int().min(1).max(10).default(4) }), body);
    return this.index.search(ctx.workspaceId!, q.query, { agentId: q.agentId, limit: q.limit });
  }

  /** A file (PDF, Word .docx or text, ≤ 15 MB), sent as multipart field `file`. Read by a job. */
  @Post("upload")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD, files: 1 } }))
  async upload(@Ctx() ctx: RequestContext, @UploadedFile() file: Express.Multer.File | undefined, @Body() body: unknown) {
    const ws = ctx.workspaceId!;
    if (!file) throw unprocessable("Choose a file to add.");
    const name = Buffer.from(file.originalname, "latin1").toString("utf8").slice(0, 200); // multer reads names as latin1
    if (/\.doc$/i.test(name)) throw unprocessable("Old Word files (.doc) can't be read. Save it as .docx or PDF and add it again.");
    if (!UPLOADABLE.test(name)) throw unprocessable("That kind of file can't be read. Use PDF, Word (.docx) or a text file.");
    const opts = parse(z.object({ availableToAll: z.enum(["true", "false"]).default("false"), attachTo: z.string().max(64).optional() }), body ?? {});
    const doc = await this.docs.create({ workspaceId: ws, name, kind: "file", source: name, status: "reading", sizeBytes: file.size, availableToAll: opts.availableToAll === "true" });
    await this.uploads.create({ workspaceId: ws, docId: doc._id, name, data: file.buffer });
    if (opts.attachTo && Types.ObjectId.isValid(opts.attachTo)) {
      await this.agents.updateOne({ _id: new Types.ObjectId(opts.attachTo), workspaceId: ws, deletedAt: null }, { $addToSet: { "draft.knowledgeIds": String(doc._id) }, $inc: { version: 1 } });
    }
    await this.jobs.enqueue("read-file", { id: String(doc._id) });
    return knowledgeOut((await this.docs.findById(doc._id).lean())!);
  }

  @Get()
  async list(@Ctx() ctx: RequestContext) {
    return (await this.docs.find({ workspaceId: ctx.workspaceId, deletedAt: null }, { content: 0 }).sort({ updatedAt: -1 }).lean()).map((d) => knowledgeOut(d as never));
  }

  @Get(":id")
  async get(@Ctx() ctx: RequestContext, @Param("id") id: string) {
    const d = await this.docs.findOne({ _id: oid(id, "That document"), workspaceId: ctx.workspaceId, deletedAt: null }).lean();
    if (!d) throw notFound("That document");
    return knowledgeOut(d, true);
  }

  @Post()
  async add(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    const input = parse(KnowledgeInputSchema, body);
    const ws = ctx.workspaceId!;
    let doc;
    if (input.kind === "text" || input.kind === "file") {
      const content = input.kind === "file" && /\.(html?|xml)$/i.test(input.name) ? htmlToText(input.content).text : input.content;
      doc = await this.docs.create({ workspaceId: ws, name: input.name, kind: input.kind, source: input.kind === "file" ? input.name : undefined, content, sizeBytes: Buffer.byteLength(content), status: "ready", availableToAll: input.availableToAll });
    } else {
      doc = await this.docs.create({ workspaceId: ws, name: input.name || input.source, kind: input.kind, source: input.source, status: "reading", availableToAll: input.availableToAll, autoRefresh: true });
    }
    if (input.attachTo && Types.ObjectId.isValid(input.attachTo)) {
      await this.agents.updateOne({ _id: new Types.ObjectId(input.attachTo), workspaceId: ws, deletedAt: null }, { $addToSet: { "draft.knowledgeIds": String(doc._id) }, $inc: { version: 1 } });
    }
    if (doc.status === "reading") await this.jobs.enqueue("ingest-knowledge", { id: String(doc._id) });
    else await this.index.reindex(doc._id);
    const fresh = await this.docs.findById(doc._id).lean();
    return knowledgeOut(fresh!);
  }

  @Post(":id/refresh")
  async refresh(@Ctx() ctx: RequestContext, @Param("id") id: string) {
    const d = await this.docs.findOneAndUpdate({ _id: oid(id, "That document"), workspaceId: ctx.workspaceId, deletedAt: null, kind: { $in: ["url", "sitemap", "site"] } }, { $set: { status: "reading", error: null }, $inc: { version: 1 } }, { new: true }).lean();
    if (!d) throw notFound("That web document");
    await this.jobs.enqueue("ingest-knowledge", { id: String(d._id) });
    return knowledgeOut((await this.docs.findById(d._id).lean())!);
  }

  @Patch(":id")
  async save(@Ctx() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    const { version, ...set } = parse(z.object({ version: z.number().int(), name: z.string().min(1).max(200).optional(), availableToAll: z.boolean().optional(), autoRefresh: z.boolean().optional(), content: z.string().max(400_000).optional() }), body);
    const extra = set.content !== undefined ? { sizeBytes: Buffer.byteLength(set.content) } : {};
    const saved = await saveVersioned(this.docs, { _id: oid(id, "That document"), workspaceId: ctx.workspaceId! }, version, { $set: { ...set, ...extra } }, (d) => knowledgeOut(d as never), "That document");
    if (set.content !== undefined || set.name !== undefined) await this.index.reindex(saved._id);
    return knowledgeOut(saved, true);
  }

  @Delete(":id")
  async remove(@Ctx() ctx: RequestContext, @Param("id") id: string) {
    const _id = oid(id, "That document");
    const users = await this.agents.find({ workspaceId: ctx.workspaceId, deletedAt: null, "draft.knowledgeIds": id }).lean();
    if (users.length) throw conflict(`${users.map((a) => (a.draft as { name: string }).name).join(", ")} ${users.length === 1 ? "uses" : "use"} it. Detach it first.`);
    const res = await this.docs.updateOne({ _id, workspaceId: ctx.workspaceId, deletedAt: null }, { $set: { deletedAt: new Date(), content: "" } });
    if (!res.matchedCount) throw notFound("That document");
    await this.index.reindex(_id); // clears its passages
    return { deleted: true };
  }
}
