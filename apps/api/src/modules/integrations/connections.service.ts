// Real connections for integrations that take an API key (Cal.com, GoHighLevel,
// Twenty). The key is checked with the provider before it's kept, then stored
// sealed; only this service ever opens it, to talk to the provider for the
// workspace.

import { Inject, Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { integrationInfo } from "@outreach/core/integrations";
import type { Types } from "mongoose";
import { ApiError, notFound, unprocessable } from "../../common/errors";
import { seal, secretKey, unseal } from "../../common/secrets";
import { integrationOut } from "../../common/serialize";
import { ENV, type Env } from "../../config/env";
import type { M } from "../../db/models";
import { CalCom } from "./calcom";
import { Ghl } from "./ghl";
import { Twenty } from "./twenty";
import { type Bookable, type CalendarClient, type CrmClient, ProviderError } from "./providers";

export interface Calendar {
  client: CalendarClient;
  eventType: Bookable;
}

type Client = CalCom | Ghl | Twenty;

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

  /** A client for a provider with a key (and, for GHL, the sub-account). */
  client(provider: string, apiKey: string, accountId?: string | null): Client {
    if (provider === "calcom") return new CalCom(apiKey, this.env.CALCOM_API_URL);
    if (provider === "gohighlevel") {
      if (!accountId) throw unprocessable("Add the sub-account ID too.");
      return new Ghl(apiKey, accountId, this.env.GHL_API_URL);
    }
    if (provider === "twenty") {
      const base = (accountId || this.env.TWENTY_API_URL).trim().replace(/\/+$/, "");
      if (!/^https?:\/\/[^/\s]+/.test(base)) throw unprocessable("The server address should look like https://crm.example.com.");
      // Anything but Twenty Cloud (or this server's configured address) is someone's own server: guarded.
      return new Twenty(apiKey, base, base !== this.env.TWENTY_API_URL.replace(/\/+$/, ""));
    }
    throw notFound("That integration");
  }

  /** Check the key with the provider, then keep it (sealed) with the account it belongs to. */
  async connectWithKey(ws: Types.ObjectId, provider: string, apiKey: string, accountId?: string) {
    const info = integrationInfo(provider);
    if (!info?.apiKey) throw notFound("That integration");
    if (info.apiKey.account && !info.apiKey.account.optional && !accountId?.trim()) throw unprocessable(`Add the ${info.apiKey.account.label.charAt(0).toLowerCase()}${info.apiKey.account.label.slice(1)} too.`);
    const key = this.sealKey();
    const client = this.client(provider, apiKey, accountId?.trim());
    let account: string;
    let calendars: Bookable[];
    if (client instanceof CalCom) {
      const me = await client.me().catch(toApiError);
      account = me.email || me.username;
      calendars = await client.calendars().catch(toApiError);
    } else if (client instanceof Twenty) {
      await client.check().catch(toApiError);
      account = new URL((accountId?.trim() || this.env.TWENTY_API_URL).replace(/\/+$/, "")).host;
      calendars = [];
    } else {
      // Listing calendars proves the token works for this sub-account.
      calendars = await client.calendars().catch(toApiError);
      account = (await client.locationName()) || `Sub-account ${client.locationId}`;
    }
    const first = calendars[0];
    const doc = await this.integrations
      .findOneAndUpdate(
        { workspaceId: ws, providerId: provider },
        {
          $set: { connected: true, hasKey: true, secret: seal(key, apiKey), accountId: accountId?.trim().replace(/\/+$/, "") || null, account, eventType: first ? { id: first.id, name: first.name, minutes: first.minutes } : null },
          $unset: { lastError: 1 },
        },
        { upsert: true, new: true },
      )
      .lean();
    return integrationOut(doc!);
  }

  private async open(ws: Types.ObjectId, provider: string) {
    const doc = await this.integrations.findOne({ workspaceId: ws, providerId: provider, connected: true, hasKey: true }).select("+secret").lean();
    if (!doc?.secret) return null;
    return { doc, client: this.client(provider, unseal(this.sealKey(), doc.secret), doc.accountId) };
  }

  /** What a connected calendar can book into, for the picker. */
  async eventTypes(ws: Types.ObjectId, provider: string): Promise<Bookable[]> {
    const c = await this.open(ws, provider);
    if (!c) throw notFound("That connection");
    if (!("calendars" in c.client)) return [];
    return c.client.calendars().catch(toApiError);
  }

  async setEventType(ws: Types.ObjectId, provider: string, id: string | number) {
    const t = (await this.eventTypes(ws, provider)).find((x) => String(x.id) === String(id));
    if (!t) throw unprocessable("That calendar isn't in the connected account.");
    const doc = await this.integrations.findOneAndUpdate({ workspaceId: ws, providerId: provider }, { $set: { eventType: { id: t.id, name: t.name, minutes: t.minutes } } }, { new: true }).lean();
    return integrationOut(doc!);
  }

  /** What a call books with: the client and the calendar, or null when it isn't connected or none is picked. */
  async calendar(ws: Types.ObjectId, provider: string): Promise<Calendar | null> {
    const c = await this.open(ws, provider);
    const et = c?.doc.eventType as Bookable | null | undefined;
    return c && et && "slots" in c.client ? { client: c.client, eventType: et } : null;
  }

  /** A connected CRM, or null. */
  async crm(ws: Types.ObjectId, provider: string): Promise<CrmClient | null> {
    const c = await this.open(ws, provider);
    return c && "upsertContact" in c.client ? c.client : null;
  }
}

/** A provider's refusal as a message the owner can act on. */
export function toApiError(err: unknown): never {
  if (err instanceof ProviderError) throw new ApiError(err.status === 401 ? 422 : 502, "provider", err.message);
  throw err;
}
