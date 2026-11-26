// CSV import as a job (roadmap Phase 1): the file is stored with its column
// mapping, then imported 1,000 rows at a time with core planImport (dates as
// YYYY-MM-DD read the way each column shows, one contact per number, checked
// against contacts already here). Progress is on the import document.

import { Body, Controller, Get, Param, Post, Res, type OnModuleInit } from "@nestjs/common";
import type { Response } from "express";
import { InjectModel } from "@nestjs/mongoose";
import { parseCsv } from "@outreach/core/csv";
import { IMPORT_PROBLEM_TEXT, planImport, type ImportColumn } from "@outreach/core/contacts-table";
import { countryOfZone, toE164 } from "@outreach/core/phone";
import { z } from "zod";
import { Ctx } from "../../common/decorators";
import { notFound } from "../../common/errors";
import { oid } from "../../common/ids";
import type { RequestContext } from "../../common/request";
import { WorkspaceData } from "../../common/workspace-data";
import { parse } from "../../common/zod";
import type { M, Row } from "../../db/models";
import { storeFields } from "../contacts/typed-fields";
import { JobsService } from "../jobs/jobs.service";

const Column = z.object({ index: z.number().int().min(0).max(500), name: z.string().max(200), label: z.string().max(200).default(""), samples: z.array(z.string()).max(10).default([]), type: z.enum(["text", "number", "date", "yesno", "choice", "phone", "email"]), target: z.string().max(80) });
const Input = z.object({ fileName: z.string().max(200).default("import.csv"), csv: z.string().min(1).max(15_000_000), columns: z.array(Column).max(500), list: z.string().max(80).default("") });

const MAX_PROBLEMS = 5000;
const importOut = (i: Row<"Import">) => ({ id: String(i._id), status: i.status, fileName: i.fileName, total: i.total, done: i.done, created: i.created, duplicates: i.duplicates, skipped: i.skipped, problems: i.problemCount ?? 0, error: i.error ?? null });
const cell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

@Controller("w/:ws/imports")
export class ImportsController implements OnModuleInit {
  constructor(
    @InjectModel("Import") private readonly imports: M<"Import">,
    @InjectModel("Contact") private readonly contacts: M<"Contact">,
    @InjectModel("FieldDef") private readonly fields: M<"FieldDef">,
    @InjectModel("Source") private readonly sources: M<"Source">,
    private readonly jobs: JobsService,
    private readonly data: WorkspaceData,
  ) {}

  onModuleInit() {
    this.jobs.register("import-contacts", ({ id }) => this.process(id));
  }

  @Post()
  async start(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    const input = parse(Input, body);
    const doc = await this.imports.create({ workspaceId: ctx.workspaceId, fileName: input.fileName, csv: input.csv, columns: input.columns, list: input.list, createdBy: ctx.userId });
    await this.jobs.enqueue("import-contacts", { id: String(doc._id) }, String(doc._id));
    return importOut((await this.imports.findById(doc._id).lean())!);
  }

  @Get(":id")
  async get(@Ctx() ctx: RequestContext, @Param("id") id: string) {
    const i = await this.imports.findOne({ _id: oid(id, "That import"), workspaceId: ctx.workspaceId }).lean();
    if (!i) throw notFound("That import");
    return importOut(i);
  }

  /** The rows the import left out or partly read: the file's own columns, plus the line and what was wrong. */
  @Get(":id/report")
  async report(@Ctx() ctx: RequestContext, @Param("id") id: string, @Res() res: Response) {
    const i = await this.imports.findOne({ _id: oid(id, "That import"), workspaceId: ctx.workspaceId }, { problems: 1, header: 1, fileName: 1, problemCount: 1 }).lean();
    if (!i) throw notFound("That import");
    const lines = [["Line", "Problem", ...(i.header ?? [])].map(cell).join(",")];
    for (const p of (i.problems ?? []) as { line: number; reason: string; column?: string; value?: string; cells?: string[] }[]) {
      const what = `${IMPORT_PROBLEM_TEXT[p.reason as keyof typeof IMPORT_PROBLEM_TEXT] ?? p.reason}${p.column ? ` (${p.column}: "${p.value ?? ""}")` : ""}`;
      lines.push([String(p.line), what, ...(p.cells ?? [])].map(cell).join(","));
    }
    const listed = ((i.problems ?? []) as unknown[]).length;
    if ((i.problemCount ?? 0) > listed) lines.push(cell(`…and ${(i.problemCount ?? 0) - listed} more rows like these.`));
    res.status(200);
    res.setHeader("content-type", "text/csv; charset=utf-8");
    res.setHeader("content-disposition", `attachment; filename="${(i.fileName ?? "import").replace(/[^\w.-]+/g, "_").replace(/\.csv$/i, "")}-problems.csv"`);
    res.send(lines.join("\n") + "\n");
  }

  private async process(id: string) {
    const job = await this.imports.findOneAndUpdate({ _id: oid(id), status: { $in: ["queued", "running"] } }, { $set: { status: "running" } }, { new: true }).lean();
    if (!job) return;
    const ws = job.workspaceId;
    try {
      const [defs, settings] = await Promise.all([this.data.defs(ws), this.data.settings(ws)]);
      const country = countryOfZone(settings.timezone);
      const parsed = parseCsv(job.csv);
      const rows = parsed.slice(1); // the first row is the header
      const columns = job.columns as ImportColumn[];
      const source = await this.sources.create({ workspaceId: ws, kind: "csv", name: job.fileName, list: job.list, fieldKeys: columns.filter((c) => c.target.startsWith("field:")).map((c) => c.target.slice(6)), rows: 0, lastSyncAt: new Date(), status: "syncing" });
      await this.imports.updateOne({ _id: job._id }, { $set: { total: rows.length, sourceId: String(source._id), header: parsed[0] ?? [], problems: [], problemCount: 0 } });
      const known = [...defs];
      let created = 0;
      let duplicates = 0;
      let skipped = 0;
      let problemCount = 0;
      let kept = 0;
      for (let at = 0; at < rows.length; at += 1000) {
        const batch = rows.slice(at, at + 1000);
        const phoneCol = columns.find((c) => c.target === "phone")?.index ?? -1;
        const e164s = batch.map((r) => toE164(r[phoneCol] ?? "", country)).filter((x): x is string => Boolean(x));
        const existing = (await this.contacts.find({ workspaceId: ws, phoneE164: { $in: e164s } }, { phone: 1 }).lean()).map((c) => ({ phone: c.phone }));
        const plan = planImport(columns, batch, job.list, known, String(source._id), existing, country);
        for (const f of plan.newFields) {
          await this.fields.updateOne({ workspaceId: ws, key: f.key }, { $setOnInsert: { label: f.label, type: f.type, source: String(source._id) } }, { upsert: true });
          known.push(f);
        }
        duplicates += plan.duplicates;
        skipped += plan.skipped;
        if (plan.problems.length) {
          problemCount += plan.problems.length;
          const room = MAX_PROBLEMS - kept;
          const add = plan.problems.slice(0, Math.max(0, room)).map((p) => ({ line: at + p.row + 2, reason: p.reason, column: p.column, value: p.value, cells: batch[p.row] ?? [] }));
          kept += add.length;
          if (add.length) await this.imports.updateOne({ _id: job._id }, { $push: { problems: { $each: add } } });
        }
        const docs = plan.contacts.map((c) => ({ workspaceId: ws, name: c.name, phone: c.phone, phoneE164: toE164(c.phone, country), email: c.email, groups: c.groups, fields: storeFields(c.fields, known), sourceId: String(source._id) }));
        try {
          const res = await this.contacts.insertMany(docs, { ordered: false, lean: true });
          created += res.length;
        } catch (err) {
          // Someone else added a number meanwhile: count those as duplicates, keep the rest.
          const inserted = (err as { insertedDocs?: unknown[] }).insertedDocs?.length ?? 0;
          created += inserted;
          duplicates += docs.length - inserted;
        }
        await this.imports.updateOne({ _id: job._id }, { $set: { done: Math.min(rows.length, at + batch.length), created, duplicates, skipped, problemCount } });
      }
      await this.sources.updateOne({ _id: source._id }, { $set: { rows: created, status: "synced", lastSyncAt: new Date() } });
      await this.imports.updateOne({ _id: job._id }, { $set: { status: "done", csv: "" } });
    } catch (err) {
      await this.imports.updateOne({ _id: job._id }, { $set: { status: "failed", error: err instanceof Error ? err.message : "The import failed." } });
      throw err;
    }
  }
}
