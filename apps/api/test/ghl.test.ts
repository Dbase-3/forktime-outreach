import type { INestApplication } from "@nestjs/common";
import { getModelToken } from "@nestjs/mongoose";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Types, type Model } from "mongoose";
import request from "supertest";
import { signRuntime } from "../src/common/runtime-signature";
import { startApp, withWorkspace } from "./helpers";

// A stand-in for GoHighLevel's API v2 for one sub-account ("loc_1"): checks the
// token and each area's Version header, and keeps what it was sent.
const seen: { slots: URLSearchParams[]; upserts: Record<string, unknown>[]; notes: { contactId: string; body: Record<string, unknown> }[]; appointments: Record<string, unknown>[] } = { slots: [], upserts: [], notes: [], appointments: [] };

function fakeGhl(): Server {
  return createServer(async (req: IncomingMessage, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const send = (status: number, body: unknown) => (res.writeHead(status, { "content-type": "application/json" }), res.end(JSON.stringify(body)));
    if (req.headers.authorization !== "Bearer pit-good") return send(401, { statusCode: 401, message: "Invalid JWT" });
    const area = url.pathname.startsWith("/calendars") ? "2021-04-15" : "2021-07-28";
    if (req.headers.version !== area) return send(400, { statusCode: 400, message: "wrong Version" });
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : null;
    if (url.pathname === "/locations/loc_1") return send(200, { location: { id: "loc_1", name: "Bright Smile Dental" } });
    if (url.pathname === "/calendars/") {
      if (url.searchParams.get("locationId") !== "loc_1") return send(403, { statusCode: 403, message: "The token does not have access to this location" });
      return send(200, { calendars: [{ id: "cal_a", name: "Consults", isActive: true, slotDuration: 45, slotDurationUnit: "mins" }, { id: "cal_off", name: "Old", isActive: false, slotDuration: 30 }] });
    }
    if (url.pathname === "/calendars/cal_a/free-slots") {
      seen.slots.push(url.searchParams);
      const day = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
      return send(200, { [day]: { slots: [`${day}T09:00:00+11:00`, `${day}T13:15:00+11:00`] }, traceId: "t1" });
    }
    if (url.pathname === "/contacts/upsert") {
      seen.upserts.push(body);
      return send(200, { new: true, contact: { id: "ct_9" }, traceId: "t2" });
    }
    const note = url.pathname.match(/^\/contacts\/([^/]+)\/notes$/);
    if (note) {
      seen.notes.push({ contactId: note[1], body });
      return send(201, { note: { id: "n1" } });
    }
    if (url.pathname === "/calendars/events/appointments") {
      seen.appointments.push(body);
      return send(200, { id: "appt_1", startTime: body.startTime, calendarId: body.calendarId });
    }
    send(404, { statusCode: 404, message: "Not found" });
  });
}

const KEY = "k".repeat(40);
let app: INestApplication;
let stop: () => Promise<void>;
let ghl: Server;
beforeAll(async () => {
  ghl = fakeGhl();
  await new Promise<void>((r) => ghl.listen(0, "127.0.0.1", r));
  process.env.GHL_API_URL = `http://127.0.0.1:${(ghl.address() as AddressInfo).port}`;
  process.env.INTEGRATIONS_KEY = "cd".repeat(32);
  process.env.AGENT_RUNTIME_KEY = KEY;
  process.env.LIVEKIT_URL = "";
  ({ app, stop } = await startApp());
});
afterAll(async () => {
  await stop();
  ghl.close();
});

const signedPost = (path: string, body: object) => {
  const raw = JSON.stringify(body);
  return request(app.getHttpServer()).post(path).set("content-type", "application/json").set("x-runtime-signature", signRuntime(KEY, "POST", path, raw)).send(raw);
};

async function connected() {
  const w = await withWorkspace(app, `ghl${Math.random()}@example.com`, { sample: true, name: "Bright Smile" });
  await w.agent.put(`${w.ws}/integrations/gohighlevel`).send({ apiKey: "pit-good", accountId: "loc_1" }).expect(200);
  return w;
}

/** A live call on the workspace's first agent, with the given workflow and after-call actions. */
async function liveCall(w: { agent: unknown; ws: string; id: string }, steps: unknown[], afterCall: unknown[] = []) {
  const agents: Model<{ draft: Record<string, unknown> }> = app.get(getModelToken("Agent"));
  const flowId = (await (w.agent as request.Agent).get(`${w.ws}/agents`)).body[0].id;
  const a = (await agents.findById(flowId).lean())!;
  const draft = { ...a.draft, timezone: "Australia/Sydney", agent: { ...(a.draft.agent as object), name: "Maya" }, steps, afterCall, dataFields: [] };
  const calls: Model<unknown> = app.get(getModelToken("Call"));
  const call = (await calls.create({ workspaceId: new Types.ObjectId(w.id), agentId: new Types.ObjectId(flowId), direction: "inbound", startedAt: new Date(), live: true, test: true, fromNumber: "+61400111222", config: draft })) as unknown as { _id: Types.ObjectId };
  return String(call._id);
}

describe("connecting GoHighLevel", () => {
  it("needs the sub-account too, and refuses a token GHL turns down", async () => {
    const { agent, ws } = await withWorkspace(app, "ghlbad@example.com");
    expect((await agent.put(`${ws}/integrations/gohighlevel`).send({ apiKey: "pit-good" }).expect(422)).body.error.message).toMatch(/sub-account ID/);
    expect((await agent.put(`${ws}/integrations/gohighlevel`).send({ apiKey: "pit-wrong", accountId: "loc_1" }).expect(422)).body.error.message).toMatch(/didn't accept that key/);
    expect((await agent.put(`${ws}/integrations/gohighlevel`).send({ apiKey: "pit-good", accountId: "loc_other" }).expect(422)).body.error.message).toMatch(/access to this location/);
    expect((await agent.get(`${ws}/integrations`)).body).toEqual([]);
  });

  it("names the sub-account, books into its first active calendar, and lists only active ones", async () => {
    const { agent, ws } = await connected();
    const list = (await agent.get(`${ws}/integrations`)).body;
    expect(list.find((i: { id: string }) => i.id === "gohighlevel")).toMatchObject({ connected: true, account: "Bright Smile Dental", eventType: { id: "cal_a", name: "Consults", minutes: 45 } });
    expect(JSON.stringify(list)).not.toContain("pit-good");
    expect((await agent.get(`${ws}/integrations/gohighlevel/event-types`).expect(200)).body).toEqual([{ id: "cal_a", name: "Consults", minutes: 45 }]);
    await agent.put(`${ws}/integrations/gohighlevel/event-type`).send({ id: "cal_off" }).expect(422);
  });
});

describe("booking on a GHL calendar during a call", () => {
  const steps = [{ id: "bk", kind: "action", action: "book", detail: "Consult", integration: "gohighlevel" }, { id: "e1", kind: "end", outcome: "booked", text: "See you then." }];

  it("free times come from the picked calendar, in the agent's time zone", async () => {
    const w = await connected();
    const callId = await liveCall(w, steps);
    const res = await signedPost(`/runtime/calls/${callId}/calendar/times`, {}).expect(200);
    expect(res.body.text).toMatch(/45 minutes each/);
    expect(res.body.text).toMatch(/9 am \[.*T09:00:00\+11:00\], 1:15 pm \[/);
    const q = seen.slots.at(-1)!;
    expect(q.get("timezone")).toBe("Australia/Sydney");
    expect(Number(q.get("endDate")) - Number(q.get("startDate"))).toBeLessThan(31 * 86_400_000);
  });

  it("books by saving the caller as a contact first, then the appointment with its end time", async () => {
    const w = await connected();
    const callId = await liveCall(w, steps);
    const start = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10) + "T09:00:00+11:00";
    const res = await signedPost(`/runtime/calls/${callId}/calendar/book`, { start, name: "Ann Lee" }).expect(200);
    expect(res.body).toMatchObject({ ok: true });
    expect(seen.upserts.at(-1)).toMatchObject({ locationId: "loc_1", name: "Ann Lee", firstName: "Ann", lastName: "Lee", phone: "+61400111222" });
    expect(seen.appointments.at(-1)).toMatchObject({ calendarId: "cal_a", locationId: "loc_1", contactId: "ct_9", startTime: start, endTime: new Date(Date.parse(start) + 45 * 60_000).toISOString(), appointmentStatus: "confirmed" });
  });
});

describe("saving to GHL", () => {
  it("after the call: the caller as a contact and a note with the summary and answers", async () => {
    const w = await connected();
    const callId = await liveCall(w, [{ id: "q", kind: "ask", question: "Name?", field: "contactName", answerType: "text" }, { id: "e", kind: "end", outcome: "done", text: "Bye" }], [{ id: "ac", kind: "save_contact", integration: "gohighlevel", fields: [], detail: "" }]);
    await signedPost(`/runtime/calls/${callId}/events`, { events: [{ type: "saved", field: "contactName", value: "Bo Diaz" }, { type: "ended", outcome: "done", summary: "Bo wants a consult.", endReason: "agent_ended", durationSec: 40 }] }).expect(200);
    const calls: Model<{ transcript: { who: string; text: string }[] }> = app.get(getModelToken("Call"));
    let lines: string[] = [];
    for (let i = 0; i < 50 && !lines.some((t) => t.includes("GoHighLevel")); i++) {
      await new Promise((r) => setTimeout(r, 20));
      lines = ((await calls.findById(callId).lean())?.transcript ?? []).map((l) => l.text);
    }
    expect(lines).toContain("After the call: saved Bo Diaz to GoHighLevel, with a note of the call (test call, really saved)");
    expect(seen.upserts.at(-1)).toMatchObject({ name: "Bo Diaz", phone: "+61400111222" });
    const note = seen.notes.at(-1)!;
    expect(note.contactId).toBe("ct_9");
    expect(note.body.title).toBe("Phone call with Maya: done");
    expect(note.body.body).toMatch(/Bo wants a consult\.\n\nAnswers:\n- .*: Bo Diaz/);
  });

  it("a CRM step during the call saves with the answers so far", async () => {
    const w = await connected();
    const callId = await liveCall(w, []);
    const res = await signedPost(`/runtime/calls/${callId}/crm`, { provider: "gohighlevel", saved: { contactName: "Cy Ng" } }).expect(200);
    expect(res.body.text).toBe("saved Cy Ng to GoHighLevel, with a note of the call (test call, really saved)");
  });

  it("the call's setup lists GHL as a CRM and as the calendar", async () => {
    const w = await connected();
    const callId = await liveCall(w, [{ id: "bk", kind: "action", action: "book", detail: "", integration: "gohighlevel" }, { id: "e1", kind: "end", outcome: "booked", text: "Bye" }]);
    const path = `/runtime/calls/${callId}`;
    const cfg = (await request(app.getHttpServer()).get(path).set("x-runtime-signature", signRuntime(KEY, "GET", path, "")).expect(200)).body;
    expect(cfg.crms).toEqual(["gohighlevel"]);
    expect(cfg.calendar).toEqual({ provider: "gohighlevel", name: "GoHighLevel", eventType: "Consults" });
  });
});
