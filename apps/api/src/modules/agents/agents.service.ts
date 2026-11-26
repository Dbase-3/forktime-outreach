// Agents: a draft the owner edits, and published versions campaigns run
// (roadmap §2.1 "No versions"). Publishing runs the same go-live checks as the
// screen (@outreach/core flowIssues) and needs a number. One agent per number
// is a database rule; a live agent can't drop its number; an agent a running
// campaign uses can't be unpublished or deleted.

import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { flowIssues } from "@outreach/core/flow-tree";
import { AgentDraftSchema, type AgentDraft } from "@outreach/core/schemas";
import { TEMPLATES, flowFromTemplate } from "@outreach/core/templates";
import { Types } from "mongoose";
import { conflict, notFound, stale, unprocessable } from "../../common/errors";
import { agentOut } from "../../common/serialize";
import { saveVersioned } from "../../common/versioned";
import { WorkspaceData } from "../../common/workspace-data";
import { parse } from "../../common/zod";
import type { M, Row } from "../../db/models";

@Injectable()
export class AgentsService {
  constructor(
    @InjectModel("Agent") private readonly agents: M<"Agent">,
    @InjectModel("AgentVersion") private readonly versions: M<"AgentVersion">,
    @InjectModel("PhoneNumber") private readonly numbers: M<"PhoneNumber">,
    @InjectModel("Campaign") private readonly campaigns: M<"Campaign">,
    @InjectModel("Knowledge") private readonly knowledge: M<"Knowledge">,
    private readonly data: WorkspaceData,
  ) {}

  async list(ws: Types.ObjectId) {
    return (await this.agents.find({ workspaceId: ws, deletedAt: null }).sort({ updatedAt: -1 }).lean()).map(agentOut);
  }

  async get(ws: Types.ObjectId, id: Types.ObjectId) {
    const a = await this.agents.findOne({ _id: id, workspaceId: ws, deletedAt: null }).lean();
    if (!a) throw notFound("That agent");
    return agentOut(a);
  }

  async create(ws: Types.ObjectId, input: { templateId?: string | null; name: string; numberId?: string | null }) {
    const template = input.templateId ? TEMPLATES.find((t) => t.id === input.templateId) ?? null : null;
    if (input.templateId && !template) throw unprocessable("That template doesn't exist.");
    const settings = await this.data.settings(ws);
    const { id: _id, status: _s, numberId: _n, updatedAt: _u, ...draft } = flowFromTemplate(template, new Date(), settings.timezone);
    const numberId = input.numberId ? await this.freeNumber(ws, input.numberId, null) : null;
    const doc = await this.agents.create({ workspaceId: ws, draft: { ...draft, name: input.name.trim() || draft.name }, numberId });
    return agentOut(doc.toObject());
  }

  async saveDraft(ws: Types.ObjectId, id: Types.ObjectId, version: number, patch: Partial<AgentDraft>) {
    const current = await this.agents.findOne({ _id: id, workspaceId: ws, deletedAt: null }).lean();
    if (!current) throw notFound("That agent");
    const draft = parse(AgentDraftSchema, { ...(current.draft as object), ...patch });
    await this.checkKnowledge(ws, draft.knowledgeIds);
    return agentOut(await saveVersioned(this.agents, { _id: id, workspaceId: ws }, version, { $set: { draft } }, agentOut, "That agent"));
  }

  async setNumber(ws: Types.ObjectId, id: Types.ObjectId, version: number, numberId: string | null) {
    const current = await this.agents.findOne({ _id: id, workspaceId: ws, deletedAt: null }).lean();
    if (!current) throw notFound("That agent");
    if (!numberId && current.status === "live") throw conflict("A live agent needs a number. Switch it to draft first, or pick another number.");
    const next = numberId ? await this.freeNumber(ws, numberId, id) : null;
    try {
      return agentOut(await saveVersioned(this.agents, { _id: id, workspaceId: ws }, version, { $set: { numberId: next } }, agentOut, "That agent"));
    } catch (err) {
      if ((err as { code?: number }).code === 11000) throw await this.numberTaken(ws, numberId as string);
      throw err;
    }
  }

  async publish(ws: Types.ObjectId, id: Types.ObjectId, version: number, userId: Types.ObjectId) {
    const current = await this.agents.findOne({ _id: id, workspaceId: ws, deletedAt: null }).lean();
    if (!current) throw notFound("That agent");
    if (current.version !== version) throw stale(agentOut(current));
    const flow = agentOut(current);
    const issues = flowIssues(flow, await this.data.knownFields(ws), await this.data.connected(ws)).map((i) => i.message);
    if (!current.numberId) issues.unshift("Pick a phone number for it to call from and answer on.");
    if (issues.length) throw unprocessable("Fix these before going live.", { issues });
    const last = await this.versions.findOne({ agentId: id }).sort({ n: -1 }).lean();
    const v = await this.versions.create({ workspaceId: ws, agentId: id, n: (last?.n ?? 0) + 1, config: current.draft, publishedBy: userId });
    return agentOut(await saveVersioned(this.agents, { _id: id, workspaceId: ws }, version, { $set: { status: "live", publishedVersionId: v._id } }, agentOut, "That agent"));
  }

  async unpublish(ws: Types.ObjectId, id: Types.ObjectId, version: number) {
    await this.refuseIfCalling(ws, id, "switch it to draft");
    return agentOut(await saveVersioned(this.agents, { _id: id, workspaceId: ws }, version, { $set: { status: "draft" } }, agentOut, "That agent"));
  }

  async versionsOf(ws: Types.ObjectId, id: Types.ObjectId) {
    const list = await this.versions.find({ workspaceId: ws, agentId: id }, { config: 0 }).sort({ n: -1 }).lean();
    return list.map((v) => ({ id: String(v._id), n: v.n, publishedAt: v.createdAt.toISOString() }));
  }

  /** A copy starts as a draft with no number (numbers belong to one agent). */
  async duplicate(ws: Types.ObjectId, id: Types.ObjectId) {
    const source = await this.agents.findOne({ _id: id, workspaceId: ws, deletedAt: null }).lean();
    if (!source) throw notFound("That agent");
    const names = new Set((await this.agents.find({ workspaceId: ws, deletedAt: null }, { "draft.name": 1 }).lean()).map((a) => (a.draft as AgentDraft).name));
    const base = (source.draft as AgentDraft).name;
    let name = `${base} copy`;
    for (let n = 2; names.has(name); n++) name = `${base} copy ${n}`;
    const doc = await this.agents.create({ workspaceId: ws, draft: { ...(source.draft as AgentDraft), name }, numberId: null });
    return agentOut(doc.toObject());
  }

  /** Soft delete; the number is freed; past calls keep their history. */
  async remove(ws: Types.ObjectId, id: Types.ObjectId) {
    await this.refuseIfCalling(ws, id, "delete it");
    const res = await this.agents.updateOne({ _id: id, workspaceId: ws, deletedAt: null }, { $set: { deletedAt: new Date(), numberId: null, status: "draft" } });
    if (!res.matchedCount) throw notFound("That agent");
    return { deleted: true };
  }

  // ---- helpers ----

  private async freeNumber(ws: Types.ObjectId, numberId: string, forAgent: Types.ObjectId | null): Promise<Types.ObjectId> {
    if (!Types.ObjectId.isValid(numberId)) throw notFound("That number");
    const n = await this.numbers.findOne({ _id: new Types.ObjectId(numberId), workspaceId: ws }).lean();
    if (!n) throw notFound("That number");
    const owner = await this.agents.findOne({ numberId: n._id, deletedAt: null, ...(forAgent ? { _id: { $ne: forAgent } } : {}) }).lean();
    if (owner) throw await this.numberTaken(ws, numberId);
    return n._id;
  }

  private async numberTaken(ws: Types.ObjectId, numberId: string) {
    const owner = await this.agents.findOne({ workspaceId: ws, numberId: new Types.ObjectId(numberId), deletedAt: null }).lean();
    const name = owner ? (owner.draft as AgentDraft).name : "another agent";
    return conflict(`This number belongs to ${name}. A number can answer for one agent only. Get another number, or pick a free one.`, { ownerId: owner ? String(owner._id) : null });
  }

  private async refuseIfCalling(ws: Types.ObjectId, id: Types.ObjectId, what: string) {
    const running = await this.campaigns.find({ workspaceId: ws, deletedAt: null, status: "running", "config.agentId": String(id) }).lean();
    if (running.length) throw conflict(`It's calling in ${running.map((c) => `“${(c.config as { name: string }).name}”`).join(", ")}. Pause that first, then ${what}.`);
  }

  private async checkKnowledge(ws: Types.ObjectId, ids: string[]) {
    if (!ids.length) return;
    const valid = ids.filter((x) => Types.ObjectId.isValid(x)).map((x) => new Types.ObjectId(x));
    const found = await this.knowledge.countDocuments({ _id: { $in: valid }, workspaceId: ws, deletedAt: null });
    if (found !== new Set(ids).size) throw unprocessable("Some attached knowledge isn't in this workspace any more.");
  }
}

export type AgentRow = Row<"Agent">;
