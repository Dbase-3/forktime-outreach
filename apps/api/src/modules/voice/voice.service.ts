// Calls with a real voice. The API files the call, opens a LiveKit room and
// sends the agent in; the agent fetches what it needs (signed) and reports
// back as the call goes: lines, saved answers, the path, actions, the end.

import { Inject, Injectable, Logger } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { businessOf } from "@outreach/core/variables";
import { dataSchema, structuredResult } from "@outreach/core/agent-data";
import { INLINE_KNOWLEDGE_CHARS, callOutcomes, type CallSetup } from "@outreach/core/call-instructions";
import { AFTER_CALL_LABELS, integrationName, needsConnection } from "@outreach/core/connections";
import { CRMS, addDays, bookingCalendarOf, dateIn, describeSlots, whenLabel } from "@outreach/core/calendar";
import { callNote, personOf } from "@outreach/core/crm";
import type { AgentDraft } from "@outreach/core/schemas";
import { fill } from "@outreach/core/variables";
import { Types } from "mongoose";
import { z } from "zod";
import { KnowledgeIndex } from "../../common/knowledge-index";
import { ApiError, conflict, notFound, unprocessable } from "../../common/errors";
import { countryOfZone, dncSet, toE164 } from "@outreach/core/phone";
import { ENV, type Env } from "../../config/env";
import { SharedLine } from "../numbers/shared-line.service";
import { WorkspaceData } from "../../common/workspace-data";
import { parse } from "../../common/zod";
import type { M } from "../../db/models";
import { contactOut } from "../contacts/contacts.service";
import { ConnectionsService } from "../integrations/connections.service";
import { ProviderError } from "../integrations/providers";
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
  /** Connected CRMs a workflow step can save the caller to (GoHighLevel, Twenty). */
  crms: string[];
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

/** The other side's number on a phone call: the number dialled when we call out, the caller's when they call in. */
export const theirNumber = (call: { direction?: string | null; fromNumber?: string | null; toNumber?: string | null }) => (call.direction === "outbound" ? call.toNumber : call.fromNumber) ?? null;

@Injectable()
export class VoiceService {
  private readonly log = new Logger("Voice");

  constructor(
    @InjectModel("Call") private readonly calls: M<"Call">,
    @InjectModel("Agent") private readonly agents: M<"Agent">,
    @InjectModel("AgentVersion") private readonly versions: M<"AgentVersion">,
    @InjectModel("Contact") private readonly contacts: M<"Contact">,
    @InjectModel("PhoneNumber") private readonly numbers: M<"PhoneNumber">,
    @InjectModel("Knowledge") private readonly knowledge: M<"Knowledge">,
    private readonly data: WorkspaceData,
    private readonly index: KnowledgeIndex,
    private readonly livekit: LiveKitService,
    private readonly connections: ConnectionsService,
    private readonly line: SharedLine,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * The owner has the agent's draft ring a real phone from the Lisna line (owner 2026-11-28: outbound
   * only, a demo line). A test call like the browser one (draft, `test`), but over the phone; the
   * owner can listen in from the browser. One at a time per workspace; PHONE_CALLS_MAX across Lisna.
   */
  async startPhone(ws: Types.ObjectId, agentId: Types.ObjectId, user: { id: Types.ObjectId; email: string }, o: { to: string; contactId: string | null }) {
    this.livekit.ready();
    if (!this.line.ready) throw new ApiError(503, "phone_off", "Phone calls aren't set up on this server yet.");
    const agent = await this.agents.findOne({ _id: agentId, workspaceId: ws, deletedAt: null }).lean();
    if (!agent) throw notFound("That agent");
    const from = agent.numberId ? await this.numbers.findOne({ _id: agent.numberId, workspaceId: ws }).lean() : null;
    if (!from?.shared) throw unprocessable("Give this agent the Lisna line first: Config → Number.");
    const settings = await this.data.settings(ws);
    const to = toE164(o.to, countryOfZone(settings.timezone));
    if (!to) throw unprocessable("That isn't a phone number we can call. Include the country code, like +1 or +61.");
    if (to === from.e164) throw unprocessable("That's the Lisna line itself.");
    if (dncSet(settings.doNotCall ?? [], countryOfZone(settings.timezone)).has(to)) throw unprocessable("That number is on your do-not-call list.");
    const recent = { live: true, toNumber: { $exists: true }, startedAt: { $gte: new Date(Date.now() - 15 * 60_000) } };
    if (await this.calls.exists({ ...recent, workspaceId: ws })) throw conflict("A phone call is going already. End it first.");
    if ((await this.calls.countDocuments(recent)) >= this.env.PHONE_CALLS_MAX) throw conflict("The Lisna line is busy. Try again in a minute.");
    // The contact picked in Preview, else whoever in Contacts has this number (their details fill the variables).
    const contact =
      (o.contactId && Types.ObjectId.isValid(o.contactId) ? await this.contacts.findOne({ _id: new Types.ObjectId(o.contactId), workspaceId: ws, deletedAt: null }, { _id: 1 }).lean() : null) ??
      (await this.contacts.findOne({ workspaceId: ws, phoneE164: to, deletedAt: null }, { _id: 1 }).lean());
    const draft = agent.draft as AgentDraft;
    const call = await this.calls.create({ workspaceId: ws, agentId, contactId: contact?._id ?? null, direction: "outbound", fromNumber: from.e164, toNumber: to, startedAt: new Date(), live: true, test: true, config: draft });
    const callId = String(call._id);
    try {
      await this.livekit.startRoom(roomOf(callId), callId, { phone: true });
      await this.livekit.dial(roomOf(callId), { to, from: from.e164, trunk: this.env.LISNA_OUTBOUND_TRUNK!, name: draft.name });
      const pass = await this.livekit.listenerPass(roomOf(callId), `listen-${String(user.id)}`, user.email);
      this.log.log(`call ${callId}: ringing ${to.slice(0, -4)}•••• from the Lisna line`);
      return { callId, room: roomOf(callId), to, ...pass };
    } catch (err) {
      await this.calls.updateOne({ _id: call._id }, { $set: { live: false, endReason: "failed", outcome: "failed" } });
      await this.livekit.closeRoom(roomOf(callId)).catch(() => undefined);
      this.log.warn(`call ${callId}: couldn't place the phone call: ${err instanceof Error ? err.message : err}`);
      throw new ApiError(502, "phone_failed", "The phone call couldn't be placed. Try again in a minute.");
    }
  }

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
      phone: theirNumber(call) || person?.phone || "", // the number this call is really on comes first
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
      crms: CRMS.filter((c) => connected.includes(c)),
      maxCallMinutes: call.test ? 10 : 15,
    };
  }

  /** The agent's reports, in order. Unknown or finished calls refuse them. */
  async applyEvents(callId: Types.ObjectId, body: unknown) {
    const { events } = parse(EventsBody, body);
    const call = await this.calls.findById(callId, { live: 1, workspaceId: 1, config: 1, agentVersionId: 1, toNumber: 1 }).lean();
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
        const after = draft ? await this.afterCall(call.workspaceId, draft) : { lines: [], crm: [] };
        await this.calls.updateOne({ _id: callId }, { $set: { live: false, outcome: e.outcome, summary: e.summary, endReason: e.endReason, durationSec: Math.round(e.durationSec), missing }, ...(after.lines.length ? { $push: { transcript: { $each: after.lines } } } : {}) });
        this.log.log(`call ${String(callId)} ended: ${e.outcome} (${e.endReason}, ${Math.round(e.durationSec)} s)`);
        // A phone call: make sure the line is hung up (the agent does it first; this is the backstop).
        if (call.toNumber) void this.livekit.closeRoom(roomOf(String(callId))).catch(() => undefined);
        // CRM saves run after the call is filed, so the agent isn't kept waiting; each adds its line.
        if (draft && after.crm.length) void this.runAfterCallCrm(callId, draft, after.crm, { outcome: e.outcome, summary: e.summary, saved: (done?.saved ?? {}) as Record<string, string> });
      }
    }
    return { ok: true };
  }

  /**
   * The agent's after-call actions: lines for the transcript, and the CRM saves
   * to run (a connected GoHighLevel / Twenty "save the contact"). Test calls
   * send to a connected CRM too (owner, 2026-11-28); other tools are not sent yet.
   */
  private async afterCall(ws: Types.ObjectId, draft: AgentDraft): Promise<{ lines: { who: string; text: string }[]; crm: { provider: string; keys: string[] }[] }> {
    const actions = draft.afterCall ?? [];
    if (!actions.length) return { lines: [], crm: [] };
    const connected = new Set(await this.data.connected(ws));
    const lines: { who: string; text: string }[] = [];
    const crm: { provider: string; keys: string[] }[] = [];
    for (const a of actions) {
      const name = a.integration === "webhook" ? "your URL" : integrationName(a.integration);
      if (needsConnection(a.integration) && !connected.has(a.integration)) lines.push({ who: "action", text: `After the call: ${AFTER_CALL_LABELS[a.kind].toLowerCase()} in ${name} (skipped, ${name} isn't connected)` });
      else if (a.kind === "save_contact" && (CRMS as readonly string[]).includes(a.integration)) crm.push({ provider: a.integration, keys: a.fields });
      else lines.push({ who: "action", text: `After the call: ${AFTER_CALL_LABELS[a.kind].toLowerCase()} in ${name} (for the team to do)` });
    }
    return { lines, crm };
  }

  private async runAfterCallCrm(callId: Types.ObjectId, draft: AgentDraft, saves: { provider: string; keys: string[] }[], o: { outcome: string; summary: string; saved: Record<string, string> }) {
    const call = await this.calls.findById(callId).lean();
    if (!call) return;
    const lines = [];
    for (const s of saves) lines.push({ who: "action", text: `After the call: ${await this.saveToCrm(call, draft, s.provider, { ...o, keys: s.keys })}` });
    await this.calls.updateOne({ _id: callId }, { $push: { transcript: { $each: lines } } });
  }

  /** Save the call's person and a note of the call to a connected CRM. Returns what happened, for the transcript. */
  private async saveToCrm(call: { _id: Types.ObjectId; workspaceId: Types.ObjectId; contactId?: Types.ObjectId | null; direction?: string | null; fromNumber?: string | null; toNumber?: string | null; startedAt?: Date | null; test?: boolean | null }, draft: AgentDraft, provider: string, o: { outcome: string; summary: string; saved: Record<string, string>; keys?: string[] }): Promise<string> {
    const name = integrationName(provider);
    try {
      const crm = await this.connections.crm(call.workspaceId, provider);
      if (!crm) return `${name}: skipped, it isn't connected`;
      const contact = call.contactId ? await this.contacts.findOne({ _id: call.contactId, workspaceId: call.workspaceId }, { name: 1, phoneE164: 1, email: 1 }).lean() : null;
      const person = personOf({ contact, saved: o.saved, fromNumber: theirNumber(call) });
      if (!person.name && !person.phone && !person.email) return `${name}: skipped, the call gave no name, number or email`;
      const id = await crm.upsertContact(person);
      const settings = await this.data.settings(call.workspaceId);
      const tz = validZone(draft.timezone) || validZone(settings.timezone) || "UTC";
      const note = callNote({ agent: draft.agent.name, when: whenLabel((call.startedAt ?? new Date()).toISOString(), tz), outcome: o.outcome, summary: o.summary, saved: o.saved, schema: dataSchema(draft), keys: o.keys });
      await crm.addNote(id, note.title, note.body);
      return `saved ${person.name || person.phone || person.email} to ${name}, with a note of the call${call.test ? " (test call, really saved)" : ""}`;
    } catch (err) {
      const why = err instanceof ProviderError ? err.message : "it didn't answer";
      this.log.warn(`crm save failed for call ${String(call._id)} (${provider}): ${why}`);
      return `${name}: couldn't save (${why})`;
    }
  }

  /** The caller's upcoming bookings (matched on their phone or email), each with the value to move or cancel it. */
  async myBookings(callId: Types.ObjectId, body: unknown): Promise<{ text: string }> {
    const { email } = parse(z.object({ email: z.string().trim().email().max(200).optional().or(z.literal("")) }), body ?? {});
    const { call, timeZone, cal } = await this.bookingContext(callId);
    if (!cal) return { text: "The calendar isn't connected. Say the team will help with their booking." };
    const contact = call.contactId ? await this.contacts.findOne({ _id: call.contactId, workspaceId: call.workspaceId }, { name: 1, phoneE164: 1, email: 1 }).lean() : null;
    const person = personOf({ contact, saved: (call.saved ?? {}) as Record<string, string>, fromNumber: theirNumber(call) });
    const who = { phone: person.phone, email: email || person.email };
    if (!who.phone && !who.email) return { text: "There's no phone number on this call to look them up by. Ask for the email address they booked with, then call find_booking with it." };
    try {
      const found = (await cal.client.upcoming(cal.eventType.id, who)).slice(0, 5);
      if (!found.length) return { text: `No upcoming booking under ${[who.phone && "this phone number", who.email].filter(Boolean).join(" or ")}.${who.email ? "" : " Ask for the email address they booked with and try again."}` };
      await this.calls.updateOne({ _id: callId }, { $addToSet: { bookingRefs: { $each: found.map((b) => b.id) } } });
      return { text: `Their upcoming bookings (${zoneName(timeZone)} time), with the value for each in brackets:\n${found.map((b) => `- ${whenLabel(b.start, timeZone)} [${b.id}]`).join("\n")}` };
    } catch (err) {
      this.log.warn(`find bookings failed for call ${String(callId)}: ${err instanceof Error ? err.message : err}`);
      return { text: "The calendar can't be checked right now. Say the team will help with their booking." };
    }
  }

  /** Move or cancel one of the bookings this call found or made (never any other). */
  async changeBooking(callId: Types.ObjectId, body: unknown): Promise<{ ok: boolean; text: string; when?: string }> {
    const input = parse(z.discriminatedUnion("change", [z.object({ change: z.literal("move"), id: z.string().min(1).max(100), start: z.string().min(10).max(40) }), z.object({ change: z.literal("cancel"), id: z.string().min(1).max(100), reason: z.string().max(300).default("") })]), body);
    const { timeZone, cal } = await this.bookingContext(callId);
    if (!cal) return { ok: false, text: "The calendar isn't connected. Say the team will help with their booking." };
    const refs = ((await this.calls.findById(callId, { bookingRefs: 1 }).select("+bookingRefs").lean())?.bookingRefs ?? []) as string[];
    if (!refs.includes(input.id)) return { ok: false, text: "That isn't one of their bookings. Call find_booking first and use the value in brackets." };
    try {
      if (input.change === "cancel") {
        await cal.client.cancel(input.id, input.reason || "Cancelled on a phone call");
        this.log.log(`call ${String(callId)} cancelled booking ${input.id}`);
        return { ok: true, text: "Cancelled." };
      }
      if (Number.isNaN(Date.parse(input.start))) return { ok: false, text: "That isn't one of the free times. Use the exact value in brackets from check_times." };
      const moved = await cal.client.reschedule(input.id, input.start, cal.eventType.minutes);
      await this.calls.updateOne({ _id: callId }, { $addToSet: { bookingRefs: moved.id } });
      const when = whenLabel(moved.start || input.start, timeZone);
      this.log.log(`call ${String(callId)} moved booking ${input.id} to ${when}`);
      return { ok: true, when, text: `Moved to ${when}.` };
    } catch (err) {
      const why = err instanceof ProviderError ? err.message : "the calendar didn't answer";
      this.log.warn(`booking change failed for call ${String(callId)}: ${why}`);
      return { ok: false, text: `That didn't work (${why}). Offer another time, or say the team will sort it out.` };
    }
  }

  /** A workflow step "save to the CRM" during the call, with the answers so far. */
  async crmStep(callId: Types.ObjectId, body: unknown): Promise<{ text: string }> {
    const { provider, saved } = parse(z.object({ provider: z.string().max(40), saved: z.record(z.string().max(64), z.string().max(500)).default({}) }), body);
    const call = await this.calls.findById(callId).lean();
    if (!call || !call.live) throw notFound("That call");
    let draft = call.config as AgentDraft | undefined;
    if (!draft && call.agentVersionId) draft = (await this.versions.findById(call.agentVersionId).lean())?.config as AgentDraft | undefined;
    if (!draft) throw notFound("That agent");
    return { text: await this.saveToCrm(call, draft, provider, { outcome: "in progress", summary: "", saved: { ...((call.saved ?? {}) as Record<string, string>), ...saved } }) };
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
      return { text: text ? `Free times in ${zoneName(timeZone)} time (${cal.eventType.minutes} minutes each), with the value to book each one in brackets:\n${text}\nIf they might be in another time zone, say the times are ${zoneName(timeZone)} time.` : `No free times from ${start} for a few weeks. Ask which other day suits them, or say the team will be in touch.` };
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
    // The caller's own answers first, then the call's contact, then the calling number (same rule as CRM saves).
    const contact = call.contactId ? await this.contacts.findOne({ _id: call.contactId, workspaceId: call.workspaceId }, { name: 1, phoneE164: 1, email: 1 }).lean() : null;
    const person = personOf({ contact, saved: (call.saved ?? {}) as Record<string, string>, fromNumber: theirNumber(call) });
    try {
      const booked = await cal.client.book({ calendarId: cal.eventType.id, minutes: cal.eventType.minutes, start, name, timeZone, email: email || person.email || undefined, phone: person.phone, metadata: { lisnaCallId: String(callId), ...(call.test ? { test: "yes" } : {}) } });
      const when = whenLabel(booked.start || start, timeZone);
      await this.calls.updateOne({ _id: callId }, { $addToSet: { bookingRefs: booked.id } });
      this.log.log(`call ${String(callId)} booked ${booked.id} for ${when}`);
      return { ok: true, when, text: `Booked: ${when}.` };
    } catch (err) {
      const why = err instanceof ProviderError ? err.message : "the calendar didn't answer";
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

/** "Sydney" for Australia/Sydney: how people name a time zone. */
const zoneName = (tz: string) => (tz === "UTC" ? "UTC" : (tz.split("/").pop() ?? tz).replace(/_/g, " "));

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
