// A demo workspace from the same sample the prototype shows (@outreach/core
// sample.ts): agents, numbers, knowledge, contacts, campaigns, calls. Sample
// ids ("f_lead", "c_3") are mapped to new ObjectIds; links between them kept.

import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { seedState } from "@outreach/core/sample";
import { toE164 } from "@outreach/core/phone";
import { countryOfZone } from "@outreach/core/phone";
import { Types } from "mongoose";
import { KnowledgeIndex } from "../../common/knowledge-index";
import type { M } from "../../db/models";
import { storeFields } from "../contacts/typed-fields";

/** Replaces the last digits of a formatted number, keeping its spaces and brackets: "0491 570 156" + "4821" → "0491 574 821". */
export function withLastDigits(display: string, tail: string): string {
  const out = display.split("");
  let k = tail.length - 1;
  for (let i = out.length - 1; i >= 0 && k >= 0; i--) if (/\d/.test(out[i])) out[i] = tail[k--];
  return out.join("");
}

@Injectable()
export class SampleService {
  constructor(
    @InjectModel("Agent") private readonly agents: M<"Agent">,
    @InjectModel("AgentVersion") private readonly versions: M<"AgentVersion">,
    @InjectModel("PhoneNumber") private readonly numbers: M<"PhoneNumber">,
    @InjectModel("Knowledge") private readonly knowledge: M<"Knowledge">,
    @InjectModel("FieldDef") private readonly fields: M<"FieldDef">,
    @InjectModel("Contact") private readonly contacts: M<"Contact">,
    @InjectModel("Source") private readonly sources: M<"Source">,
    @InjectModel("Campaign") private readonly campaigns: M<"Campaign">,
    @InjectModel("Call") private readonly calls: M<"Call">,
    @InjectModel("Integration") private readonly integrations: M<"Integration">,
    private readonly index: KnowledgeIndex,
  ) {}

  /** Fills an empty workspace with the sample. Numbers get workspace-unique fictional E.164s. */
  async fill(workspaceId: Types.ObjectId, now = new Date()) {
    const s = seedState(now);
    const ids = new Map<string, Types.ObjectId>();
    const idOf = (old: string) => {
      if (!ids.has(old)) ids.set(old, new Types.ObjectId());
      return ids.get(old) as Types.ObjectId;
    };
    const country = countryOfZone(s.settings.timezone);
    const ws = { workspaceId };

    // Sample numbers are shared fictional ones; each workspace gets its own (same range, last four digits
    // picked at random and checked as free: numbers are unique across workspaces).
    const taken = new Set<string>();
    const freeNumber = async (e164: string) => {
      for (let tries = 0; tries < 50; tries++) {
        const tail = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
        const next = `${e164.slice(0, -4)}${tail}`;
        if (!taken.has(next) && !(await this.numbers.exists({ e164: next }))) {
          taken.add(next);
          return tail;
        }
      }
      throw new Error("No free sample number left in that range.");
    };
    const numbers = [];
    for (const n of s.numbers) {
      const tail = await freeNumber(n.e164);
      numbers.push({ ...ws, _id: idOf(n.id), e164: `${n.e164.slice(0, -4)}${tail}`, display: withLastDigits(n.display, tail), country: n.country, kind: n.kind, area: n.area });
    }
    await this.numbers.insertMany(numbers);
    await this.fields.insertMany(s.fieldDefs.map((f) => ({ ...ws, ...f })));
    await this.knowledge.insertMany(s.knowledge.map((k) => ({ ...ws, _id: idOf(k.id), name: k.name, kind: k.kind, source: k.source, content: k.content, sizeBytes: k.sizeBytes, pages: k.pages, status: k.status, error: k.error, availableToAll: k.availableToAll, autoRefresh: k.autoRefresh })));
    await this.index.reindexWorkspace(workspaceId);
    await this.sources.insertMany(s.sources.map((x) => ({ ...ws, _id: idOf(x.id), kind: x.kind, integrationId: x.integrationId, name: x.name, object: x.object, list: x.list, fieldKeys: x.fieldKeys, rows: x.rows, syncEvery: x.syncEvery, lastSyncAt: new Date(x.lastSyncAt), status: x.status })));

    for (const f of s.flows) {
      const { id, status, numberId, updatedAt, ...draft } = f;
      const agentId = idOf(id);
      const draftOut = { ...draft, knowledgeIds: draft.knowledgeIds.map(idOf).map(String) };
      let publishedVersionId: Types.ObjectId | null = null;
      if (status === "live") {
        publishedVersionId = new Types.ObjectId();
        await this.versions.create({ ...ws, _id: publishedVersionId, agentId, n: 1, config: draftOut });
      }
      await this.agents.create({ ...ws, _id: agentId, draft: draftOut, status, numberId: numberId ? idOf(numberId) : null, publishedVersionId, updatedAt: new Date(updatedAt) });
    }

    const lastCall = new Map<string, { at: string; outcome: string }>();
    for (const c of s.calls) {
      const prev = lastCall.get(c.contactId);
      if (!c.live && (!prev || c.startedAt > prev.at)) lastCall.set(c.contactId, { at: c.startedAt, outcome: c.outcome });
    }
    await this.contacts.insertMany(
      s.contacts.map((c) => ({
        ...ws,
        _id: idOf(c.id),
        name: c.name,
        phone: c.phone,
        phoneE164: toE164(c.phone, country),
        email: c.email,
        groups: c.groups,
        fields: storeFields(c.fields, s.fieldDefs),
        sourceId: c.sourceId ? String(idOf(c.sourceId)) : undefined,
        lastCallAt: lastCall.get(c.id) ? new Date(lastCall.get(c.id)!.at) : null,
        lastOutcome: lastCall.get(c.id)?.outcome ?? null,
        createdAt: new Date(c.createdAt),
      })),
    );

    await this.campaigns.insertMany(
      s.campaigns.map((c) => {
        const { id, status, called, answered, createdAt, ...config } = c;
        return {
          ...ws,
          _id: idOf(id),
          config: { ...config, agentId: String(idOf(config.agentId)), followUps: config.followUps.map((f) => ({ ...f, agentId: f.agentId ? String(idOf(f.agentId)) : undefined })) },
          status,
          called,
          answered,
          createdAt: new Date(createdAt),
        };
      }),
    );

    // Calls in batches: the sample has about a thousand.
    const callDocs = s.calls.map((c) => ({
      ...ws,
      contactId: c.contactId ? idOf(c.contactId) : null,
      agentId: idOf(c.flowId),
      direction: c.direction,
      startedAt: new Date(c.startedAt),
      durationSec: c.durationSec,
      outcome: c.outcome,
      summary: c.summary,
      saved: c.saved,
      transcript: c.transcript,
      recording: c.recording,
      endReason: c.endReason,
      actions: c.actions,
      mood: c.mood,
      feedback: c.feedback ?? null,
      checkResults: c.checkResults,
      live: c.live ?? false,
      lead: c.lead,
      engagement: c.engagement,
      transferTo: c.transferTo,
    }));
    for (let i = 0; i < callDocs.length; i += 500) await this.calls.insertMany(callDocs.slice(i, i + 500), { ordered: false });

    await this.integrations.insertMany(s.integrations.filter((i) => i.connected).map((i) => ({ ...ws, providerId: i.id, connected: true, account: i.account })));
    return { settings: s.settings };
  }
}
