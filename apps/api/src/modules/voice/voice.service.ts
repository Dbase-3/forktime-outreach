// Calls with a real voice. The API files the call, opens a LiveKit room and
// sends the agent in; the agent fetches what it needs (signed) and reports
// back as the call goes: lines, saved answers, the path, actions, the end.

import { Injectable, Logger } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { businessOf } from "@outreach/core/variables";
import { dataSchema, structuredResult } from "@outreach/core/agent-data";
import { INLINE_KNOWLEDGE_CHARS, callOutcomes, type CallSetup } from "@outreach/core/call-instructions";
import { AFTER_CALL_LABELS, integrationName, needsConnection } from "@outreach/core/connections";
import { addDays, bookingCalendarOf, dateIn, describeSlots, whenLabel } from "@outreach/core/calendar";
import type { AgentDraft } from "@outreach/core/schemas";
import { fill } from "@outreach/core/variables";
import { Types } from "mongoose";
import { z } from "zod";
import { KnowledgeIndex } from "../../common/knowledge-index";
import { conflict, notFound } from "../../common/errors";
import { WorkspaceData } from "../../common/workspace-data";
import { parse } from "../../common/zod";
import type { M } from "../../db/models";
import { contactOut } from "../contacts/contacts.service";
import { ConnectionsService } from "../integrations/connections.service";
import { CalComError } from "../integrations/calcom";
import { LiveKitService } from "./livekit.service";

/** What the agent gets for a call: everything to run it, nothing else of the workspace. */
export interface RuntimeConfig extends CallSetup {
  callId: string;
  agentId: string;
  greeting: string;
  outcomes: string[];
  voice: { voiceId: string; speed: number; language: string; name: string };
  choices: Record<string, string[]>; // per field key, when its answer is one of a list
  connected: string[]; // integrations the workspace has connected: a step needing another is skipped
  /** The calendar this call books into (connected, with an event type picked), or null. */
  calendar: { provider: string; name: string; eventType: string } | null;
  maxCallMinutes: number;
}

const Line = z.object({ who: z.enum(["agent", "caller", "action"]), text: z.string().min(1).max(4000), at: z.number().min(0).max(36000).optional() });
const Event = z.discriminatedUnion("type", [
  z.object({ type: z.literal("answered") }),
  z.object({ type: z.literal("line"), line: Line }),
  z.object({ type: z.literal("saved"), field: z.string().max(64), value: z.string().max(500) }),
  z.object({ type: z.literal("step"), path: z.array(z.string().max(64)).max(500) }),
  z.object({ type: z.literal("action"), action: z.string().max(40) }),
  z.object({
    type: z.literal("ended"),
    outcome: z.string().max(64),
    summary: z.string().max(2000).default(""),
    endReason: z.enum(["caller_hung_up", "agent_ended", "transferred", "no_answer", "voicemail", "busy", "failed"]),
    durationSec: z.number().min(0).max(36000),
  }),
]);
export const EventsBody = z.object({ events: z.array(Event).min(1).max(200) });

const roomOf = (callId: string) => `pf-${callId}`;

@Injectable()
export class VoiceService {
  private readonly log = new Logger("Voice");

  constructor(
    @InjectModel("Call") private readonly calls: M<"Call">,
    @InjectModel("Agent") private readonly agents: M<"Agent">,
    @InjectModel("AgentVersion") private readonly versions: M<"AgentVersion">,
    @InjectModel("Contact") private readonly contacts: M<"Contact">,
    @InjectModel("Knowledge") private readonly knowledge: M<"Knowledge">,
    private readonly data: WorkspaceData,
    private readonly index: KnowledgeIndex,
    private readonly livekit: LiveKitService,
    private readonly connections: ConnectionsService,
  ) {}

  /** The owner talks to the agent's current draft from the browser. */
  async startTest(ws: Types.ObjectId, agentId: Types.ObjectId, user: { id: Types.ObjectId; email: string }, contactId: string | null) {
    this.livekit.ready();
    const agent = await this.agents.findOne({ _id: agentId, workspaceId: ws, deletedAt: null }).lean();
    if (!agent) throw notFound("That agent");
    const busy = await this.calls.countDocuments({ workspaceId: ws, test: true, live: true, startedAt: { $gte: new Date(Date.now() - 15 * 60_000) } });
    if (busy >= 3) throw conflict("Three test calls are going already. End one first.");
    const contact = contactId && Types.ObjectId.isValid(contactId) ? await this.contacts.findOne({ _id: new Types.ObjectId(contactId), workspaceId: ws, deletedAt: null }, { _id: 1 }).lean() : null;
    const draft = agent.draft as AgentDraft;
    const call = await this.calls.create({
      workspaceId: ws,
      agentId,
      contactId: contact?._id ?? null,
      direction: draft.direction === "inbound" ? "inbound" : "outbound",
      startedAt: new Date(),
      live: true,
      test: true,
      config: draft,
    });
    const callId = String(call._id);
    try {
      await this.livekit.startRoom(roomOf(callId), callId);
      const pass = await this.livekit.browserPass(roomOf(callId), `owner-${String(user.id)}`, user.email);
      return { callId, room: roomOf(callId), ...pass };
    } catch (err) {
      await this.calls.updateOne({ _id: call._id }, { $set: { live: false, endReason: "failed", outcome: "failed" } });
      throw err;
    }
  }

  async hangUp(ws: Types.ObjectId, callId: Types.ObjectId) {
    const c = await this.calls.findOne({ _id: callId, workspaceId: ws }, { _id: 1, test: 1 }).lean();
    if (!c) throw notFound("That call");
    await this.livekit.closeRoom(roomOf(String(callId)));
    return { ok: true };
  }

  /** Everything the agent needs for one call (it asks once, at the start). */
  async runtimeConfig(callId: Types.ObjectId): Promise<RuntimeConfig> {
    const call = await this.calls.findById(callId).lean();
    if (!call || !call.live) throw notFound("That call");
    const ws = call.workspaceId;
    let draft = call.config as AgentDraft | undefined;
    if (!draft && call.agentVersionId) draft = (await this.versions.findById(call.agentVersionId).lean())?.config as AgentDraft | undefined;
    if (!draft) throw notFound("That agent");
    const settings = await this.data.settings(ws);
    const business = businessOf(draft, settings.businessName) || "the business";
    const contact = call.contactId ? await this.contacts.findOne({ _id: call.contactId, workspaceId: ws }).lean() : null;
    const person = contact ? contactOut(contact) : null;
    const values: Record<string, string> = {
      ...(person?.fields ?? {}),
      agent: draft.agent.name,
      business,
      today: todayIn(draft.timezone || settings.timezone),
      first_name: person?.name.split(" ")[0] ?? "",
      name: person?.name ?? "",
      phone: person?.phone ?? call.fromNumber ?? "",
    };

    const docs = await this.knowledge
      .find({ workspaceId: ws, deletedAt: null, status: "ready", $or: [{ availableToAll: true }, { _id: { $in: draft.knowledgeIds.filter((x) => Types.ObjectId.isValid(x)).map((x) => new Types.ObjectId(x)) } }] }, { name: 1, content: 1 })
      .lean();
    const total = docs.reduce((n, d) => n + (d.content?.length ?? 0), 0);
    const inline = total <= INLINE_KNOWLEDGE_CHARS ? docs.filter((d) => d.content).map((d) => ({ name: d.name, text: d.content })) : [];

    const schema = dataSchema(draft);
    const choices: Record<string, string[]> = {};
    for (const f of draft.dataFields) if (f.choices?.length) choices[f.key] = f.choices;
    const walk = (steps: AgentDraft["steps"]): void => steps.forEach((s) => (s.kind === "ask" && s.choices?.length ? (choices[s.field] = s.choices) : s.kind === "branch" ? (walk(s.yes), walk(s.no)) : undefined));
    walk(draft.steps);

    const connected = await this.data.connected(ws);
    const provider = bookingCalendarOf(draft, connected);
    const cal = provider ? await this.connections.calendar(ws, provider) : null;

    return {
      callId: String(call._id),
      agentId: String(call.agentId),
      flow: draft,
      business,
      direction: call.direction as "inbound" | "outbound",
      values,
      schema,
      choices,
      knowledge: { inline, searchable: inline.length === 0 && docs.length > 0 },
      test: Boolean(call.test),
      greeting: fill(draft.greeting, values),
      outcomes: callOutcomes(draft),
      voice: { ...draft.agent, voiceId: draft.agent.voiceId },
      connected,
      calendar: provider && cal ? { provider, name: integrationName(provider), eventType: cal.eventType.name } : null,
      maxCallMinutes: call.test ? 10 : 15,
    };
  }

  /** The agent's reports, in order. Unknown or finished calls refuse them. */
  async applyEvents(callId: Types.ObjectId, body: unknown) {
    const { events } = parse(EventsBody, body);
    const call = await this.calls.findById(callId, { live: 1, workspaceId: 1, config: 1, agentVersionId: 1 }).lean();
    if (!call) throw notFound("That call");
    if (!call.live) throw conflict("That call has ended.");
    for (const e of events) {
      if (e.type === "answered") continue;
      if (e.type === "line") await this.calls.updateOne({ _id: callId }, { $push: { transcript: e.line } });
      else if (e.type === "saved") await this.calls.updateOne({ _id: callId }, { $set: { [`saved.${e.field.replace(/[.$]/g, "_")}`]: e.value } });
      else if (e.type === "step") await this.calls.updateOne({ _id: callId }, { $set: { path: e.path } });
      else if (e.type === "action") await this.calls.updateOne({ _id: callId }, { $addToSet: { actions: e.action } });
      else if (e.type === "ended") {
        const done = await this.calls.findById(callId, { saved: 1 }).lean();
        let draft = call.config as AgentDraft | undefined;
        if (!draft && call.agentVersionId) draft = (await this.versions.findById(call.agentVersionId).lean())?.config as AgentDraft | undefined;
        const missing = draft ? structuredResult(dataSchema(draft), (done?.saved ?? {}) as Record<string, string>).missingRequired : [];
        const after = draft ? await this.afterCallLines(call.workspaceId, draft, Boolean(call.test)) : [];
        await this.calls.updateOne({ _id: callId }, { $set: { live: false, outcome: e.outcome, summary: e.summary, endReason: e.endReason, durationSec: Math.round(e.durationSec), missing }, ...(after.length ? { $push: { transcript: { $each: after } } } : {}) });
        this.log.log(`call ${String(callId)} ended: ${e.outcome} (${e.endReason}, ${Math.round(e.durationSec)} s)`);
      }
    }
    return { ok: true };
  }

  /**
   * What the agent's after-call actions did, as lines on the transcript. Test
   * calls send nothing; a real send comes with the integrations (Phase 6).
   */
  private async afterCallLines(ws: Types.ObjectId, draft: AgentDraft, test: boolean) {
    const actions = draft.afterCall ?? [];
    if (!actions.length) return [];
    const connected = new Set(await this.data.connected(ws));
    return actions.map((a) => {
      const what = `After the call: ${AFTER_CALL_LABELS[a.kind].toLowerCase()} in ${a.integration === "webhook" ? "your URL" : integrationName(a.integration)}`;
      const how = needsConnection(a.integration) && !connected.has(a.integration) ? `skipped, ${integrationName(a.integration)} isn't connected` : test ? "test call, nothing was sent" : "for the team to do";
      return { who: "action", text: `${what} (${how})` };
    });
  }

  /** The call's agent, its time zone, and the calendar it books into: for check_times / book_time. */
  private async bookingContext(callId: Types.ObjectId) {
    const call = await this.calls.findById(callId).lean();
    if (!call || !call.live) throw notFound("That call");
    let draft = call.config as AgentDraft | undefined;
    if (!draft && call.agentVersionId) draft = (await this.versions.findById(call.agentVersionId).lean())?.config as AgentDraft | undefined;
    if (!draft) throw notFound("That agent");
    const settings = await this.data.settings(call.workspaceId);
    const timeZone = validZone(draft.timezone) || validZone(settings.timezone) || "UTC";
    const provider = bookingCalendarOf(draft, await this.data.connected(call.workspaceId));
    const cal = provider ? await this.connections.calendar(call.workspaceId, provider) : null;
    return { call, timeZone, cal };
  }

  /** Free times from a day on (default today), in words with the exact values to book. Never throws for a provider problem: the model gets a sentence. */
  async freeTimes(callId: Types.ObjectId, body: unknown): Promise<{ text: string }> {
    const { from, days } = parse(z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), days: z.number().int().min(1).max(14).default(7) }), body ?? {});
    const { timeZone, cal } = await this.bookingContext(callId);
    if (!cal) return { text: "The calendar isn't connected. Say the team will confirm a time with them." };
    const today = dateIn(timeZone);
    const start = from && from > today ? from : today;
    try {
      let starts = await cal.client.slots(cal.eventType.id, start, addDays(start, days - 1), timeZone);
      // Nothing that week: look one more fortnight ahead before saying so.
      if (!starts.length && !from) starts = await cal.client.slots(cal.eventType.id, addDays(start, days), addDays(start, days + 13), timeZone);
      const text = describeSlots(starts.filter((s) => Date.parse(s) > Date.now()), timeZone);
      return { text: text ? `Free times (${cal.eventType.minutes} minutes each), with the value to book each one in brackets:\n${text}` : `No free times from ${start} for a few weeks. Ask which other day suits them, or say the team will be in touch.` };
    } catch (err) {
      this.log.warn(`free times failed for call ${String(callId)}: ${err instanceof Error ? err.message : err}`);
      return { text: "The calendar can't be checked right now. Say the team will confirm a time with them." };
    }
  }

  /** Book a time for the caller. A refusal comes back as words for the model, not an error. */
  async book(callId: Types.ObjectId, body: unknown): Promise<{ ok: boolean; text: string; when?: string }> {
    const { start, name, email } = parse(z.object({ start: z.string().min(10).max(40), name: z.string().trim().min(1).max(120), email: z.string().trim().email().max(200).optional().or(z.literal("")) }), body);
    if (Number.isNaN(Date.parse(start))) return { ok: false, text: "That isn't one of the times. Use the exact value in brackets from check_times." };
    const { call, timeZone, cal } = await this.bookingContext(callId);
    if (!cal) return { ok: false, text: "The calendar isn't connected. Say the team will confirm a time with them." };
    const contact = call.contactId ? await this.contacts.findOne({ _id: call.contactId, workspaceId: call.workspaceId }, { phoneE164: 1, email: 1 }).lean() : null;
    const phone = [contact?.phoneE164, call.fromNumber].find((p): p is string => typeof p === "string" && /^\+\d{8,15}$/.test(p));
    try {
      const booked = await cal.client.book({ eventTypeId: cal.eventType.id, start, name, timeZone, email: email || contact?.email || undefined, phone, metadata: { lisnaCallId: String(callId), ...(call.test ? { test: "yes" } : {}) } });
      const when = whenLabel(booked.start || start, timeZone);
      this.log.log(`call ${String(callId)} booked ${booked.uid} for ${when}`);
      return { ok: true, when, text: `Booked: ${when}.` };
    } catch (err) {
      const why = err instanceof CalComError ? err.message : "the calendar didn't answer";
      this.log.warn(`booking failed for call ${String(callId)}: ${why}`);
      const email = /email/i.test(why);
      return { ok: false, text: email ? "This calendar needs an email address to book. Ask for their email, then call book_time again with it." : `It couldn't be booked (${why}). Call check_times again and offer another time.` };
    }
  }

  async search(callId: Types.ObjectId, query: string) {
    const call = await this.calls.findById(callId, { workspaceId: 1, agentId: 1, live: 1 }).lean();
    if (!call || !call.live) throw notFound("That call");
    const passages = await this.index.search(call.workspaceId, query, { agentId: String(call.agentId), limit: 3 });
    return { passages: passages.map((p) => ({ docName: p.docName, heading: p.heading, text: p.text })) };
  }
}

const validZone = (tz: string | undefined) => {
  if (!tz) return "";
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return tz;
  } catch {
    return "";
  }
};

/** "Thursday 26 November 2026" in the agent's time zone. */
export function todayIn(timezone: string, now = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-AU", { timeZone: timezone, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(now).replace(",", "");
  } catch {
    return now.toDateString();
  }
}
