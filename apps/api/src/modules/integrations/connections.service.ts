// Real connections for integrations that take an API key (Cal.com first). The
// key is checked with the provider before it's kept, then stored sealed; only
// this service ever opens it, to talk to the provider for the workspace.

import { Inject, Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { integrationInfo } from "@outreach/core/integrations";
import type { Types } from "mongoose";
import { ApiError, notFound, unprocessable } from "../../common/errors";
import { seal, secretKey, unseal } from "../../common/secrets";
import { integrationOut } from "../../common/serialize";
import { ENV, type Env } from "../../config/env";
import type { M } from "../../db/models";
import { CalCom, CalComError, type CalEventType } from "./calcom";

export interface Calendar {
  client: CalCom;
  eventType: { id: number; name: string; minutes: number };
}

@Injectable()
export class ConnectionsService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @InjectModel("Integration") private readonly integrations: M<"Integration">,
  ) {}

  private sealKey(): Buffer {
    const key = secretKey(this.env.INTEGRATIONS_KEY);
    if (!key) throw unprocessable("Connecting with a key isn't set up on this server yet.");
    return key;
  }

  calcom(apiKey: string): CalCom {
    return new CalCom(apiKey, this.env.CALCOM_API_URL);
  }

  /** Check the key with the provider, then keep it (sealed) with the account it belongs to. */
  async connectWithKey(ws: Types.ObjectId, provider: string, apiKey: string) {
    const info = integrationInfo(provider);
    if (!info?.apiKey) throw notFound("That integration");
    const key = this.sealKey();
    if (provider !== "calcom") throw notFound("That integration");
    const client = this.calcom(apiKey);
    const me = await client.me().catch(toApiError);
    const types = (await client.eventTypes().catch(toApiError)).filter((t) => !t.hidden);
    const first = types[0];
    const doc = await this.integrations
      .findOneAndUpdate(
        { workspaceId: ws, providerId: provider },
        { $set: { connected: true, hasKey: true, secret: seal(key, apiKey), account: me.email || me.username, eventType: first ? { id: first.id, name: first.name, minutes: first.minutes } : null }, $unset: { lastError: 1 } },
        { upsert: true, new: true },
      )
      .lean();
    return integrationOut(doc!);
  }

  private async clientFor(ws: Types.ObjectId, provider: string) {
    const doc = await this.integrations.findOne({ workspaceId: ws, providerId: provider, connected: true, hasKey: true }).select("+secret").lean();
    if (!doc?.secret) return null;
    const apiKey = unseal(this.sealKey(), doc.secret);
    return { doc, client: this.calcom(apiKey) };
  }

  /** The event types a connected calendar can book into, for the picker. */
  async eventTypes(ws: Types.ObjectId, provider: string): Promise<CalEventType[]> {
    const c = await this.clientFor(ws, provider);
    if (!c) throw notFound("That connection");
    return (await c.client.eventTypes().catch(toApiError)).filter((t) => !t.hidden);
  }

  async setEventType(ws: Types.ObjectId, provider: string, eventTypeId: number) {
    const types = await this.eventTypes(ws, provider);
    const t = types.find((x) => x.id === eventTypeId);
    if (!t) throw unprocessable("That event type isn't in your Cal.com account.");
    const doc = await this.integrations.findOneAndUpdate({ workspaceId: ws, providerId: provider }, { $set: { eventType: { id: t.id, name: t.name, minutes: t.minutes } } }, { new: true }).lean();
    return integrationOut(doc!);
  }

  /** What a call books with: the client and the event type, or null when it isn't connected or has no event type. */
  async calendar(ws: Types.ObjectId, provider: string): Promise<Calendar | null> {
    const c = await this.clientFor(ws, provider);
    const et = c?.doc.eventType as Calendar["eventType"] | null | undefined;
    return c && et ? { client: c.client, eventType: et } : null;
  }
}

/** Cal.com's refusal as a message the owner can act on. */
export function toApiError(err: unknown): never {
  if (err instanceof CalComError) throw new ApiError(err.status === 401 ? 422 : 502, "provider", err.message);
  throw err;
}
