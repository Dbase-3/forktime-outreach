// Loads what the shared rules (@outreach/core) need to judge a change: the
// workspace's agents, campaigns, fields and settings, in core shapes.

import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { KEYED_INTEGRATIONS } from "@outreach/core/integrations";
import type { Campaign, FieldDef, Flow, WorkspaceSettings } from "@outreach/core/types";
import type { KnownField } from "@outreach/core/flow-tree";
import type { Types } from "mongoose";
import type { M } from "../db/models";
import { agentOut, campaignOut, fieldOut } from "./serialize";

/** Connected integrations that can really be used: a keyed one needs its key stored. */
export const USABLE = { connected: true, $or: [{ providerId: { $nin: KEYED_INTEGRATIONS } }, { hasKey: true }] };

@Injectable()
export class WorkspaceData {
  constructor(
    @InjectModel("Agent") private readonly agents: M<"Agent">,
    @InjectModel("Campaign") private readonly campaigns: M<"Campaign">,
    @InjectModel("FieldDef") private readonly fields: M<"FieldDef">,
    @InjectModel("Workspace") private readonly workspaces: M<"Workspace">,
    @InjectModel("Integration") private readonly integrations: M<"Integration">,
  ) {}

  /** The integrations this workspace has connected (ids from @outreach/core/integrations). */
  async connected(ws: Types.ObjectId): Promise<string[]> {
    return (await this.integrations.find({ workspaceId: ws, ...USABLE }, { providerId: 1 }).lean()).map((i) => i.providerId);
  }

  async flows(ws: Types.ObjectId): Promise<Flow[]> {
    return (await this.agents.find({ workspaceId: ws, deletedAt: null }).lean()).map(agentOut);
  }

  async campaignsOf(ws: Types.ObjectId): Promise<Campaign[]> {
    return (await this.campaigns.find({ workspaceId: ws, deletedAt: null }).lean()).map(campaignOut);
  }

  async defs(ws: Types.ObjectId): Promise<FieldDef[]> {
    return (await this.fields.find({ workspaceId: ws }).lean()).map(fieldOut);
  }

  /** Fields a decision may test without asking: the contact's own, typed, plus name and phone. */
  async knownFields(ws: Types.ObjectId): Promise<KnownField[]> {
    return [...(await this.defs(ws)).map((d) => ({ key: d.key, type: d.type })), "name", "phone"];
  }

  async settings(ws: Types.ObjectId): Promise<WorkspaceSettings> {
    const w = await this.workspaces.findById(ws).lean();
    const s = w?.settings;
    return { businessName: s?.businessName ?? "", timezone: s?.timezone ?? "Australia/Sydney", callingDays: s?.callingDays ?? [1, 2, 3, 4, 5], callingStart: s?.callingStart ?? 9, callingEnd: s?.callingEnd ?? 19, doNotCall: s?.doNotCall ?? [], phoneNumber: "", inboundFlowId: "" };
  }
}
