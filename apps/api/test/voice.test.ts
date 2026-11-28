import type { INestApplication } from "@nestjs/common";
import { getModelToken } from "@nestjs/mongoose";
import { Types, type Model } from "mongoose";
import request from "supertest";
import { signRuntime } from "../src/common/runtime-signature";
import { startApp, withWorkspace } from "./helpers";

const KEY = "k".repeat(40);
let app: INestApplication;
let stop: () => Promise<void>;
beforeAll(async () => {
  process.env.AGENT_RUNTIME_KEY = KEY;
  process.env.LIVEKIT_URL = "";
  ({ app, stop } = await startApp());
});
afterAll(() => stop());

/** A request signed the way the agent signs it. */
function signed(method: "GET" | "POST", path: string, body?: object, key = KEY) {
  const raw = body ? JSON.stringify(body) : "";
  const sig = signRuntime(key, method, path, raw);
  const r = method === "GET" ? request(app.getHttpServer()).get(path) : request(app.getHttpServer()).post(path).set("content-type", "application/json").send(raw);
  return { req: r.set("x-runtime-signature", sig), sig, raw };
}

/** A live test call on the sample workspace's first agent, as startTest files it (without LiveKit). */
/** A live test call on a sample agent: the first one, or (withKnowledge) the one with documents attached. */
async function liveCall(o: { withKnowledge?: boolean } = {}) {
  const { agent, ws, id } = await withWorkspace(app, `v${Math.random()}@example.com`, { sample: true, name: "Northside Motors" });
  const all = (await agent.get(`${ws}/agents`)).body as { id: string; knowledgeIds?: string[] }[];
  // The sample's agents are saved together, so their order isn't fixed: pick the one the test needs.
  const flows = o.withKnowledge ? [all.find((f) => f.knowledgeIds?.length) ?? all[0]] : all;
  const calls: Model<unknown> = app.get(getModelToken("Call"));
  const agents: Model<{ draft: unknown }> = app.get(getModelToken("Agent"));
  const a = await agents.findById(flows[0].id).lean();
  const contact = (await agent.post(`${ws}/contacts/query`).send({ pageSize: 1 })).body.rows[0];
  const call = (await calls.create({ workspaceId: new Types.ObjectId(id), agentId: new Types.ObjectId(flows[0].id), contactId: new Types.ObjectId(contact.id), direction: "outbound", startedAt: new Date(), live: true, test: true, config: a!.draft })) as unknown as { _id: Types.ObjectId };
  return { agent, ws, callId: String(call._id), contact };
}

describe("test calls", () => {
  it("says voice isn't set up when LiveKit isn't configured, and doesn't leave the call live", async () => {
    const { agent, ws } = await withWorkspace(app, "novoice@example.com", { sample: true });
    const flowId = (await agent.get(`${ws}/agents`)).body[0].id;
    const before = (await agent.get(`${ws}/calls/live`)).body.live;
    const res = await agent.post(`${ws}/agents/${flowId}/test-call`).send({}).expect(503);
    expect(res.body.error.code).toBe("voice_off");
    expect((await agent.get(`${ws}/calls/live`)).body.live).toBe(before);
  });
});

describe("the agent's door (/runtime)", () => {
  it("refuses requests that aren't signed, are signed with another key, or are sent twice", async () => {
    const { callId } = await liveCall();
    const path = `/runtime/calls/${callId}`;
    await request(app.getHttpServer()).get(path).expect(401);
    await signed("GET", path, undefined, "x".repeat(40)).req.expect(401);
    const { sig } = signed("GET", path);
    await request(app.getHttpServer()).get(path).set("x-runtime-signature", sig).expect(200);
    await request(app.getHttpServer()).get(path).set("x-runtime-signature", sig).expect(401); // replayed
    // A body changed after signing fails.
    const ev = signed("POST", `${path}/events`, { events: [{ type: "answered" }] });
    await request(app.getHttpServer()).post(`${path}/events`).set("content-type", "application/json").set("x-runtime-signature", ev.sig).send(JSON.stringify({ events: [{ type: "answered" }, { type: "answered" }] })).expect(401);
  });

  it("accepts the signature the voice agent makes (apps/platform-agent/src/api.js)", async () => {
    const { callId } = await liveCall();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { sign } = require("../../platform-agent/src/api.js") as { sign: (k: string, m: string, p: string, b: string) => string };
    const path = `/runtime/calls/${callId}/events`;
    const body = JSON.stringify({ events: [{ type: "answered" }] });
    await request(app.getHttpServer()).post(path).set("content-type", "application/json").set("x-runtime-signature", sign(KEY, "POST", path, body)).send(body).expect(200);
  });

  it("gives the agent the call's setup: greeting filled in, the contact, outcomes, the data schema", async () => {
    const { callId, contact } = await liveCall();
    const cfg = (await signed("GET", `/runtime/calls/${callId}`).req.expect(200)).body;
    expect(cfg.test).toBe(true);
    expect(cfg.business).toBe("Northside Motors");
    expect(cfg.values.first_name).toBe(contact.name.split(" ")[0]);
    expect(cfg.values.today).toMatch(/\d{4}$/);
    expect(cfg.greeting).not.toMatch(/\{/);
    expect(cfg.greeting).toMatch(/AI assistant/);
    expect(cfg.outcomes).toContain("do_not_call");
    expect(cfg.schema.length).toBeGreaterThan(0);
    expect(cfg.knowledge.inline.length + (cfg.knowledge.searchable ? 1 : 0)).toBeGreaterThan(0);
  });

  it("files the call from the agent's reports, then refuses more", async () => {
    const { agent, ws, callId } = await liveCall();
    const path = `/runtime/calls/${callId}/events`;
    const cfg = (await signed("GET", `/runtime/calls/${callId}`).req).body;
    const field = cfg.schema[0].key as string;
    await signed("POST", path, {
      events: [
        { type: "answered" },
        { type: "line", line: { who: "agent", text: cfg.greeting, at: 0 } },
        { type: "line", line: { who: "caller", text: "Yeah, all good.", at: 4 } },
        { type: "saved", field, value: "Yes" },
        { type: "step", path: ["s1", "s2"] },
        { type: "action", action: "booked" },
      ],
    }).req.expect(200);
    let call = (await agent.get(`${ws}/calls/${callId}`)).body.call;
    expect(call.live).toBe(true);
    expect(call.transcript.map((l: { who: string }) => l.who)).toEqual(["agent", "caller"]);
    expect(call.saved[field]).toBe("Yes");
    expect(call.path).toEqual(["s1", "s2"]);
    await signed("POST", path, { events: [{ type: "ended", outcome: "not_now", summary: "They're happy.", endReason: "agent_ended", durationSec: 42.4 }] }).req.expect(200);
    call = (await agent.get(`${ws}/calls/${callId}`)).body.call;
    expect(call).toMatchObject({ outcome: "not_now", summary: "They're happy.", endReason: "agent_ended", durationSec: 42, test: true });
    expect(call.live).toBeUndefined();
    await signed("POST", path, { events: [{ type: "answered" }] }).req.expect(409);
  });

  it("searches the knowledge the agent may use", async () => {
    const { callId } = await liveCall({ withKnowledge: true });
    const res = (await signed("POST", `/runtime/calls/${callId}/search`, { query: "warranty" }).req.expect(200)).body;
    expect(res.passages[0].docName).toMatch(/Warranty/i);
  });

  it("keeps test calls out of analytics", async () => {
    const { agent, ws, callId } = await liveCall();
    await signed("POST", `/runtime/calls/${callId}/events`, { events: [{ type: "ended", outcome: "zz_test_only", summary: "", endReason: "agent_ended", durationSec: 5 }] }).req.expect(200);
    const figures = (await agent.post(`${ws}/analytics`).send({ range: "7d" })).body;
    expect(JSON.stringify(figures)).not.toMatch(/zz_test_only/);
  });
});
