import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Types } from "mongoose";
import type { SettingsSchema } from "@outreach/core/schemas";
import type { z } from "zod";
import { conflict, forbidden, notFound, stale } from "../../common/errors";
import { agentOut, campaignOut, fieldOut, integrationOut, knowledgeOut, numberOut, sourceOut } from "../../common/serialize";
import type { M, Row } from "../../db/models";
import type { Role } from "../../db/schemas";
import { Mailer } from "../auth/mailer";
import { SharedLine } from "../numbers/shared-line.service";
import { SampleService } from "./sample.service";

type Settings = Row<"Workspace">["settings"];

@Injectable()
export class WorkspacesService {
  constructor(
    @InjectModel("Workspace") private readonly workspaces: M<"Workspace">,
    @InjectModel("Membership") private readonly memberships: M<"Membership">,
    @InjectModel("Invite") private readonly invites: M<"Invite">,
    @InjectModel("User") private readonly users: M<"User">,
    @InjectModel("Agent") private readonly agents: M<"Agent">,
    @InjectModel("PhoneNumber") private readonly numbers: M<"PhoneNumber">,
    @InjectModel("Knowledge") private readonly knowledge: M<"Knowledge">,
    @InjectModel("FieldDef") private readonly fields: M<"FieldDef">,
    @InjectModel("Source") private readonly sources: M<"Source">,
    @InjectModel("Campaign") private readonly campaigns: M<"Campaign">,
    @InjectModel("Integration") private readonly integrations: M<"Integration">,
    @InjectModel("Contact") private readonly contacts: M<"Contact">,
    @InjectModel("Call") private readonly calls: M<"Call">,
    private readonly sample: SampleService,
    private readonly mailer: Mailer,
    private readonly line: SharedLine,
  ) {}

  async create(userId: Types.ObjectId, input: { name: string; timezone: string; sample: boolean }) {
    const _id = new Types.ObjectId();
    let settings: Partial<Settings> = { businessName: input.name, timezone: input.timezone };
    await this.workspaces.create({ _id, name: input.name, settings, createdBy: userId });
    await this.memberships.create({ workspaceId: _id, userId, role: "owner" });
    if (input.sample) {
      const filled = await this.sample.fill(_id);
      settings = { ...filled.settings, businessName: input.name || filled.settings.businessName };
      await this.workspaces.updateOne({ _id }, { $set: { settings: { businessName: settings.businessName, timezone: settings.timezone, callingDays: settings.callingDays, callingStart: settings.callingStart, callingEnd: settings.callingEnd, doNotCall: settings.doNotCall } } });
    }
    return { id: String(_id) };
  }

  async get(ws: Types.ObjectId, role: Role) {
    const w = await this.workspaces.findById(ws).lean();
    if (!w) throw notFound("That workspace");
    return { id: String(w._id), name: w.name, role, settings: w.settings, version: w.version };
  }

  async saveSettings(ws: Types.ObjectId, version: number, settings: z.infer<typeof SettingsSchema>) {
    const w = await this.workspaces.findOneAndUpdate({ _id: ws, version }, { $set: { settings, name: settings.businessName }, $inc: { version: 1 } }, { new: true }).lean();
    if (w) return { settings: w.settings, version: w.version };
    const current = await this.workspaces.findById(ws).lean();
    if (!current) throw notFound("That workspace");
    throw stale({ settings: current.settings, version: current.version });
  }

  /** Everything the screens need up front. Contacts and calls are paged separately. */
  async bootstrap(ws: Types.ObjectId, role: Role) {
    const live = { workspaceId: ws, deletedAt: null };
    await this.line.ensure(ws); // every workspace has the Lisna line
    const [workspace, agents, numbers, knowledge, fields, sources, campaigns, integrations, contactCount, callCount] = await Promise.all([
      this.get(ws, role),
      this.agents.find(live).sort({ updatedAt: -1 }).lean(),
      this.numbers.find({ workspaceId: ws }).sort({ createdAt: 1 }).lean(),
      this.knowledge.find(live, { content: 0 }).sort({ updatedAt: -1 }).lean(),
      this.fields.find({ workspaceId: ws }).sort({ createdAt: 1 }).lean(),
      this.sources.find({ workspaceId: ws }).lean(),
      this.campaigns.find(live).sort({ createdAt: -1 }).lean(),
      this.integrations.find({ workspaceId: ws }).lean(),
      this.contacts.countDocuments(live),
      this.calls.countDocuments({ workspaceId: ws }),
    ]);
    return {
      workspace,
      flows: agents.map(agentOut),
      numbers: numbers.map(numberOut),
      knowledge: knowledge.map((k) => knowledgeOut(k as Row<"Knowledge">)),
      fieldDefs: fields.map(fieldOut),
      sources: sources.map(sourceOut),
      campaigns: campaigns.map(campaignOut),
      integrations: integrations.map(integrationOut),
      counts: { contacts: contactCount, calls: callCount },
    };
  }

  async members(ws: Types.ObjectId) {
    const [ms, open] = await Promise.all([this.memberships.find({ workspaceId: ws }).lean(), this.invites.find({ workspaceId: ws, acceptedAt: null }).lean()]);
    const people = await this.users.find({ _id: { $in: ms.map((m) => m.userId) } }).lean();
    return {
      members: ms.map((m) => ({ userId: String(m.userId), email: people.find((p) => String(p._id) === String(m.userId))?.email ?? "", role: m.role })),
      invites: open.map((i) => ({ id: String(i._id), email: i.email, role: i.role })),
    };
  }

  async invite(ws: Types.ObjectId, byUser: Types.ObjectId, byEmail: string, email: string, role: Role, byRole: Role) {
    if (role === "owner" && byRole !== "owner") throw forbidden("Only owners can invite owners.");
    const w = await this.workspaces.findById(ws).lean();
    const existing = await this.users.findOne({ email }).lean();
    if (existing) {
      const res = await this.memberships.updateOne({ workspaceId: ws, userId: existing._id }, { $setOnInsert: { role } }, { upsert: true });
      if (!res.upsertedCount) throw conflict(`${email} is already a member.`);
    } else {
      await this.invites.updateOne({ workspaceId: ws, email }, { $set: { role, invitedBy: byUser, acceptedAt: null } }, { upsert: true });
    }
    await this.mailer.sendInvite(email, w?.name ?? "a workspace", byEmail);
    return this.members(ws);
  }

  async setRole(ws: Types.ObjectId, userId: Types.ObjectId, role: Role) {
    if (role !== "owner") await this.keepAnOwner(ws, userId);
    const res = await this.memberships.updateOne({ workspaceId: ws, userId }, { $set: { role } });
    if (!res.matchedCount) throw notFound("That member");
    return this.members(ws);
  }

  async remove(ws: Types.ObjectId, userId: Types.ObjectId) {
    await this.keepAnOwner(ws, userId);
    await this.memberships.deleteOne({ workspaceId: ws, userId });
    return this.members(ws);
  }

  async cancelInvite(ws: Types.ObjectId, inviteId: Types.ObjectId) {
    await this.invites.deleteOne({ workspaceId: ws, _id: inviteId });
    return this.members(ws);
  }

  /** A workspace always keeps at least one owner. */
  private async keepAnOwner(ws: Types.ObjectId, userId: Types.ObjectId) {
    const owners = await this.memberships.find({ workspaceId: ws, role: "owner" }).lean();
    if (owners.length === 1 && String(owners[0].userId) === String(userId)) throw conflict("A workspace needs at least one owner. Make someone else an owner first.");
  }
}
