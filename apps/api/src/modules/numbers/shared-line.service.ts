// The Lisna line (owner 2026-11-28): one real Telnyx number, LISNA_LINE, that
// every workspace has a copy of. Outbound only for now (it's on no inbound
// trunk, so calls to it reach no agent); within a workspace one agent at a time
// uses it, like any number. Buying numbers comes later.

import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { displayNumber, phoneParts } from "@outreach/core/phone";
import type { Types } from "mongoose";
import { ENV, type Env } from "../../config/env";
import type { M } from "../../db/models";

@Injectable()
export class SharedLine implements OnModuleInit {
  private readonly log = new Logger("SharedLine");

  constructor(
    @Inject(ENV) private readonly env: Env,
    @InjectModel("PhoneNumber") private readonly numbers: M<"PhoneNumber">,
  ) {}

  /** Numbers were unique everywhere (index e164_1); the shared line needs a copy per workspace. */
  async onModuleInit() {
    try {
      const old = (await this.numbers.collection.indexes()).find((i) => i.name === "e164_1");
      if (old) {
        await this.numbers.collection.dropIndex("e164_1");
        this.log.log("dropped the old e164_1 index (the shared line has a copy in every workspace)");
      }
      await this.numbers.createIndexes();
    } catch (err) {
      this.log.warn(`number indexes: ${err instanceof Error ? err.message : err}`);
    }
  }

  get number(): string | null {
    return this.env.LISNA_LINE ?? null;
  }

  /** Phone calls can be placed: the line, its trunk and LiveKit are set. */
  get ready(): boolean {
    return Boolean(this.env.LISNA_LINE && this.env.LISNA_OUTBOUND_TRUNK && this.env.LIVEKIT_URL);
  }

  /** Give the workspace its copy of the line (once; safe to call on every load). */
  async ensure(ws: Types.ObjectId): Promise<void> {
    const e164 = this.env.LISNA_LINE;
    if (!e164) return;
    const parts = phoneParts(e164);
    try {
      await this.numbers.updateOne(
        { workspaceId: ws, e164 },
        { $setOnInsert: { display: displayNumber(e164), country: parts?.country || "US", kind: "local", area: parts?.national.slice(0, 3), provider: "telnyx", shared: true, status: "active" } },
        { upsert: true },
      );
    } catch (err) {
      // Never let the line stop a workspace from loading (e.g. an old unique index still in place).
      this.log.warn(`couldn't add the Lisna line to ${String(ws)}: ${err instanceof Error ? err.message : err}`);
    }
  }
}
