import type { INestApplication } from "@nestjs/common";
import { getModelToken } from "@nestjs/mongoose";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Types, type Model } from "mongoose";
import request from "supertest";
import { signRuntime } from "../src/common/runtime-signature";
import { startApp, withWorkspace } from "./helpers";

// A stand-in for Cal.com's API v2: checks the key and each endpoint's version
// header (as the real one falls back to old behaviour without it), and keeps
// what it was asked.
const seen: { slots: URLSearchParams[]; bookings: Record<string, unknown>[] } = { slots: [], bookings: [] };
const VERSIONS: Record<string, string | undefined> = { "/v2/me": undefined, "/v2/event-types": "2024-06-14", "/v2/slots": "2024-09-04", "/v2/bookings": "2024-08-13" };
const changes: { path: string; body: Record<string, unknown> }[] = [];

function fakeCalCom(): Server {
  return createServer(async (req: IncomingMessage, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const send = (status: number, body: unknown) => (res.writeHead(status, { "content-type": "application/json" }), res.end(JSON.stringify(body)));
    if (req.headers.authorization !== "Bearer cal_live_good") return send(401, { status: "error", error: { message: "Invalid API key" } });
    if (VERSIONS[url.pathname] && req.headers["cal-api-version"] !== VERSIONS[url.pathname]) return send(400, { status: "error", error: { message: "wrong version" } });
    if (url.pathname === "/v2/me") return send(200, { status: "success", data: { id: 1, email: "owner@clinic.test", username: "clinic", timeZone: "Australia/Sydney" } });
    if (url.pathname === "/v2/event-types")
      return send(200, { status: "success", data: [{ id: 11, title: "Intro call", lengthInMinutes: 30, hidden: false }, { id: 12, title: "Secret", lengthInMinutes: 15, hidden: true }] });
    if (url.pathname === "/v2/slots") {
      seen.slots.push(url.searchParams);
      const day = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
      return send(200, { status: "success", data: { [day]: [{ start: `${day}T09:00:00.000+11:00` }, { start: `${day}T10:30:00.000+11:00` }] } });
    }
    if (url.pathname === "/v2/bookings" && req.method === "GET") {
      if (req.headers["cal-api-version"] !== "2024-08-13" || url.searchParams.get("status") !== "upcoming") return send(400, { status: "error", error: { message: "bad list" } });
      const soon = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
      return send(200, { status: "success", data: [
        { uid: "bk_mine", start: `${soon}T00:00:00.000Z`, attendees: [{ name: "Ann", phoneNumber: "+61400111222" }] },
        { uid: "bk_other", start: `${soon}T02:00:00.000Z`, attendees: [{ name: "Ann", phoneNumber: "+61499999999" }] },
      ] });
    }
    const change = url.pathname.match(/^\/v2\/bookings\/([^/]+)\/(reschedule|cancel)$/);
    if (change && req.method === "POST") {
      if (req.headers["cal-api-version"] !== "2024-08-13") return send(400, { status: "error", error: { message: "wrong version" } });
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw || "{}");
      changes.push({ path: url.pathname, body });
      return send(200, { status: "success", data: change[2] === "reschedule" ? { uid: "bk_moved", start: body.start } : { uid: change[1], status: "cancelled" } });
    }
    if (url.pathname === "/v2/bookings" && req.method === "POST") {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw);
      seen.bookings.push(body);
      if (body.attendee.name === "Needs Email" && !body.attendee.email) return send(400, { status: "error", error: { message: "attendee email is required" } });
      return send(201, { status: "success", data: { uid: "bk_1", start: body.start, status: "accepted" } });
    }
    send(404, { status: "error", error: { message: "not found" } });
  });
}

const KEY = "k".repeat(40);
let app: INestApplication;
let stop: () => Promise<void>;
let cal: Server;
beforeAll(async () => {
  cal = fakeCalCom();
  await new Promise<void>((r) => cal.listen(0, "127.0.0.1", r));
  process.env.CALCOM_API_URL = `http://127.0.0.1:${(cal.address() as AddressInfo).port}/v2`;
  process.env.INTEGRATIONS_KEY = "ab".repeat(32);
  process.env.AGENT_RUNTIME_KEY = KEY;
  process.env.LIVEKIT_URL = "";
  ({ app, stop } = await startApp());
});
afterAll(async () => {
  await stop();
  cal.close();
});

const signedPost = (path: string, body: object) => {
  const raw = JSON.stringify(body);
  return request(app.getHttpServer()).post(path).set("content-type", "application/json").set("x-runtime-signature", signRuntime(KEY, "POST", path, raw)).send(raw);
};

/** A workspace whose first agent has a Book step on Cal.com, and a live call on it. */
async function bookingCall(connect: boolean) {
  const { agent, ws, id } = await withWorkspace(app, `cal${Math.random()}@example.com`, { sample: true, name: "Bright Smile" });
  if (connect) await agent.put(`${ws}/integrations/calcom`).send({ apiKey: "cal_live_good" }).expect(200);
  const agents: Model<{ draft: { steps: unknown[]; timezone: string } }> = app.get(getModelToken("Agent"));
  const flowId = (await agent.get(`${ws}/agents`)).body[0].id;
  const a = (await agents.findById(flowId).lean())!;
  const draft = { ...a.draft, timezone: "Australia/Sydney", steps: [{ id: "bk", kind: "action", action: "book", detail: "Intro call", integration: "calcom" }, { id: "e1", kind: "end", outcome: "booked", text: "See you then." }] };
  const calls: Model<unknown> = app.get(getModelToken("Call"));
  const call = (await calls.create({ workspaceId: new Types.ObjectId(id), agentId: new Types.ObjectId(flowId), direction: "inbound", startedAt: new Date(), live: true, test: true, fromNumber: "+61400111222", config: draft })) as unknown as { _id: Types.ObjectId };
  return { agent, ws, callId: String(call._id) };
}

describe("connecting Cal.com with an API key", () => {
  it("refuses a key Cal.com doesn't accept, and keeps nothing", async () => {
    const { agent, ws } = await withWorkspace(app, "calbad@example.com");
    const res = await agent.put(`${ws}/integrations/calcom`).send({ apiKey: "cal_live_wrong" }).expect(422);
    expect(res.body.error.message).toMatch(/didn't accept that key/);
    expect((await agent.get(`${ws}/integrations`)).body).toEqual([]);
  });

  it("checks the key, names the account, picks the first visible event type, and stores the key sealed", async () => {
    const { agent, ws, id } = await withWorkspace(app, "calgood@example.com");
    const res = await agent.put(`${ws}/integrations/calcom`).send({ apiKey: "cal_live_good" }).expect(200);
    expect(res.body).toMatchObject({ id: "calcom", connected: true, account: "owner@clinic.test", eventType: { id: 11, name: "Intro call", minutes: 30 } });
    expect(JSON.stringify(res.body)).not.toContain("cal_live_good");
    expect(JSON.stringify((await agent.get(`${ws}/integrations`)).body)).not.toContain("cal_live_good");
    const integrations: Model<{ secret?: string }> = app.get(getModelToken("Integration"));
    const doc = await integrations.findOne({ workspaceId: new Types.ObjectId(id), providerId: "calcom" }).select("+secret").lean();
    expect(doc?.secret).toMatch(/^v1:/);
    expect(doc?.secret).not.toContain("cal_live_good");
  });

  it("lists only visible event types and books into the one picked", async () => {
    const { agent, ws } = await withWorkspace(app, "calpick@example.com");
    await agent.put(`${ws}/integrations/calcom`).send({ apiKey: "cal_live_good" }).expect(200);
    expect((await agent.get(`${ws}/integrations/calcom/event-types`).expect(200)).body).toEqual([{ id: 11, name: "Intro call", minutes: 30 }]);
    await agent.put(`${ws}/integrations/calcom/event-type`).send({ id: 12 }).expect(422);
    expect((await agent.put(`${ws}/integrations/calcom/event-type`).send({ id: 11 }).expect(200)).body.eventType.id).toBe(11);
  });

  it("a Cal.com saved by name only (before keys) doesn't count as connected", async () => {
    const { agent, ws, id } = await withWorkspace(app, "calold@example.com");
    const integrations: Model<unknown> = app.get(getModelToken("Integration"));
    await integrations.create({ workspaceId: new Types.ObjectId(id), providerId: "calcom", connected: true, account: "old" });
    expect((await agent.get(`${ws}/integrations`)).body[0].connected).toBe(false);
  });
});

describe("booking during a call", () => {
  it("the call's setup names the calendar it books into", async () => {
    const { callId } = await bookingCall(true);
    const path = `/runtime/calls/${callId}`;
    const cfg = (await request(app.getHttpServer()).get(path).set("x-runtime-signature", signRuntime(KEY, "GET", path, "")).expect(200)).body;
    expect(cfg.calendar).toEqual({ provider: "calcom", name: "Cal.com", eventType: "Intro call" });
  });

  it("gives free times in the agent's time zone with the exact values to book", async () => {
    const { callId } = await bookingCall(true);
    const res = await signedPost(`/runtime/calls/${callId}/calendar/times`, {}).expect(200);
    expect(res.body.text).toMatch(/30 minutes each/);
    expect(res.body.text).toMatch(/9 am \[\d{4}-\d{2}-\d{2}T09:00:00\.000\+11:00\], 10:30 am \[/);
    const q = seen.slots.at(-1)!;
    expect(q.get("eventTypeId")).toBe("11");
    expect(q.get("timeZone")).toBe("Australia/Sydney");
  });

  it("books in the caller's name with the call's number, and says when", async () => {
    const { callId } = await bookingCall(true);
    const start = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10) + "T09:00:00.000+11:00";
    const res = await signedPost(`/runtime/calls/${callId}/calendar/book`, { start, name: "Ann Lee" }).expect(200);
    expect(res.body).toMatchObject({ ok: true });
    expect(res.body.when).toMatch(/ at 9 am$/);
    expect(seen.bookings.at(-1)).toMatchObject({ eventTypeId: 11, start: new Date(start).toISOString(), attendee: { name: "Ann Lee", timeZone: "Australia/Sydney", phoneNumber: "+61400111222" }, metadata: { lisnaCallId: callId, test: "yes" } });
  });

  it("when the event type needs an email, the model is told to ask for one", async () => {
    const { callId } = await bookingCall(true);
    const res = await signedPost(`/runtime/calls/${callId}/calendar/book`, { start: new Date(Date.now() + 86_400_000).toISOString(), name: "Needs Email" }).expect(200);
    expect(res.body.ok).toBe(false);
    expect(res.body.text).toMatch(/needs an email/);
  });

  it("without a connection, the model hears the team will confirm (no error)", async () => {
    const { callId } = await bookingCall(false);
    const res = await signedPost(`/runtime/calls/${callId}/calendar/times`, {}).expect(200);
    expect(res.body.text).toMatch(/isn't connected/);
  });
});

describe("changing a booking the caller already has", () => {
  it("finds only bookings with this caller's number, and moves or cancels only those", async () => {
    const { callId } = await bookingCall(true);
    const found = (await signedPost(`/runtime/calls/${callId}/calendar/mine`, {}).expect(200)).body.text;
    expect(found).toMatch(/Sydney time/);
    expect(found).toContain("[bk_mine]");
    expect(found).not.toContain("bk_other");
    // Someone else's booking can't be touched, even with its id.
    expect((await signedPost(`/runtime/calls/${callId}/calendar/change`, { change: "cancel", id: "bk_other" }).expect(200)).body).toMatchObject({ ok: false });
    const start = new Date(Date.now() + 4 * 86_400_000).toISOString();
    const moved = (await signedPost(`/runtime/calls/${callId}/calendar/change`, { change: "move", id: "bk_mine", start }).expect(200)).body;
    expect(moved).toMatchObject({ ok: true });
    expect(changes.at(-1)).toMatchObject({ path: "/v2/bookings/bk_mine/reschedule", body: { start } });
    // The moved booking (a new uid on Cal.com) can be cancelled on the same call.
    expect((await signedPost(`/runtime/calls/${callId}/calendar/change`, { change: "cancel", id: "bk_moved", reason: "can't make it" }).expect(200)).body).toMatchObject({ ok: true, text: "Cancelled." });
    expect(changes.at(-1)).toEqual({ path: "/v2/bookings/bk_moved/cancel", body: { cancellationReason: "can't make it" } });
  });
});
