// Contacts kept in sync from a connected CRM (GoHighLevel, Twenty; owner
// 2026-11-28). A sync pulls every person page by page (up to 10,000 a run),
// matches them on the dialable number, the same rule as CSV imports (one contact
// per number), and puts them in the source's list. People without a number an
// agent can dial are skipped. The worker re-runs each source when its interval
// is up; "Sync now" and adding a source run one straight away.

import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { CRMS } from "@outreach/core/calendar";
import { countryOfZone, toE164 } from "@outreach/core/phone";
import type { Types } from "mongoose";
import { WorkspaceData } from "../../common/workspace-data";
import type { M } from "../../db/models";
import { ConnectionsService } from "../integrations/connections.service";
import { ProviderError } from "../integrations/providers";
import { JobsService } from "../jobs/jobs.service";

const MAX_PER_RUN = 10_000;
const EVERY_MS = { "15m": 15 * 60_000, "1h": 60 * 60_000, "1d": 24 * 60 * 60_000 } as const;
const TICK_MS = 5 * 60_000;

export const isLiveSync = (integrationId: string | undefined | null) => (CRMS as readonly string[]).includes(integrationId ?? "");

@Injectable()
export class ContactSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger("ContactSync");
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @InjectModel("Source") private readonly sources: M<"Source">,
    @InjectModel("Contact") private readonly contacts: M<"Contact">,
    private readonly jobs: JobsService,
    private readonly connections: ConnectionsService,
    private readonly data: WorkspaceData,
  ) {}

  onModuleInit() {
    this.jobs.register("sync-contacts", ({ id }) => this.run(id));
    // Only the process that runs jobs looks for due syncs (checked at each tick: the worker starts after init).
    this.timer = setInterval(() => void (this.jobs.isWorker ? this.queueDue().catch((err) => this.log.warn(`due syncs: ${err.message}`)) : undefined), TICK_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Mark the source as syncing and queue a run. */
  async start(id: Types.ObjectId | string): Promise<void> {
    await this.sources.updateOne({ _id: id }, { $set: { status: "syncing" }, $unset: { lastError: 1 } });
    await this.jobs.enqueue("sync-contacts", { id: String(id) }, `sync-${String(id)}-${Date.now()}`);
  }

  /** Sources whose interval is up (or stuck syncing for over an hour). */
  async queueDue(now = Date.now()): Promise<number> {
    const list = await this.sources.find({ kind: "sync", integrationId: { $in: [...CRMS] } }, { syncEvery: 1, lastSyncAt: 1, status: 1, updatedAt: 1 }).lean();
    let queued = 0;
    for (const s of list) {
      const every = EVERY_MS[(s.syncEvery as keyof typeof EVERY_MS) ?? "1h"] ?? EVERY_MS["1h"];
      const last = s.lastSyncAt ? new Date(s.lastSyncAt).getTime() : 0;
      const stuck = s.status === "syncing" && now - new Date(s.updatedAt ?? 0).getTime() > 60 * 60_000;
      if ((s.status !== "syncing" && now - last >= every) || stuck) {
        await this.start(s._id);
        queued++;
      }
    }
    return queued;
  }

  async run(id: string): Promise<void> {
    const src = await this.sources.findById(id).lean();
    if (!src || src.kind !== "sync" || !isLiveSync(src.integrationId)) return;
    const ws = src.workspaceId as Types.ObjectId;
    try {
      const crm = await this.connections.crm(ws, src.integrationId!);
      if (!crm) throw new ProviderError("It isn't connected any more. Connect it again under Integrations.", 400);
      const country = countryOfZone((await this.data.settings(ws)).timezone);
      const list = src.list || "Synced";
      let after: string | null = null;
      let seen = 0;
      let kept = 0;
      let skipped = 0;
      do {
        const page = await crm.listContacts(after);
        after = page.next;
        seen += page.contacts.length;
        const ops = [];
        for (const c of page.contacts) {
          const e164 = toE164(c.phone, country);
          if (!e164) {
            skipped++;
            continue;
          }
          ops.push({
            updateOne: {
              filter: { workspaceId: ws, phoneE164: e164 },
              update: {
                $set: { ...(c.name ? { name: c.name } : {}), ...(c.email ? { email: c.email } : {}) },
                $addToSet: { groups: list },
                $setOnInsert: { phone: c.phone ?? e164, sourceId: String(src._id), fields: {}, deletedAt: null, version: 1, ...(c.name ? {} : { name: "" }) },
              },
              upsert: true,
            },
          });
        }
        if (ops.length) {
          try {
            await this.contacts.bulkWrite(ops, { ordered: false });
          } catch (err) {
            // Two people with one number in a page: the first one wins, the rest are still written.
            if ((err as { code?: number }).code !== 11000) throw err;
          }
          kept += ops.length;
        }
      } while (after && seen < MAX_PER_RUN);
      await this.sources.updateOne({ _id: src._id }, { $set: { rows: kept, status: "synced", lastSyncAt: new Date(), skipped } });
      this.log.log(`source ${id}: ${kept} contacts synced, ${skipped} without a dialable number`);
    } catch (err) {
      const why = err instanceof ProviderError ? err.message : "The sync didn't finish.";
      await this.sources.updateOne({ _id: src._id }, { $set: { status: "error", lastError: why, lastSyncAt: new Date() } });
      this.log.warn(`source ${id} failed: ${err instanceof Error ? err.message : err}`);
    }
  }
}
