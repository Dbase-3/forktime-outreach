import type { INestApplication } from "@nestjs/common";
import { getModelToken } from "@nestjs/mongoose";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Types, type Model } from "mongoose";
import request from "supertest";
import { signRuntime } from "../src/common/runtime-signature";
import { startApp, withWorkspace } from "./helpers";

// A stand-in for Twenty's REST API (standard objects only): people with a
// filter, notes, note targets with `targetPersonId`.
const seen: { people: Record<string, unknown>[]; filters: string[]; notes: Record<string, unknown>[]; targets: Record<string, unknown>[] } = { people: [], filters: [], notes: [], targets: [] };

function fakeTwenty(): Server {
  return createServer(async (req: IncomingMessage, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const send = (status: number, body: unknown) => (res.writeHead(status, { "content-type": "application/json" }), res.end(JSON.stringify(body)));
    if (req.headers.authorization !== "Bearer tw-good-key") return send(401, { statusCode: 401, messages: ["Token invalid."], error: "UNAUTHENTICATED" });
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : null;
    if (url.pathname === "/rest/people" && req.method === "GET") {
      const filter = url.searchParams.get("filter");
      if (filter) seen.filters.push(filter);
      const known = filter === "emails.primaryEmail[eq]:'known@x.com'";
      return send(200, { data: { people: known ? [{ id: "p_known" }] : [] }, totalCount: known ? 1 : 0 });
    }
    if (url.pathname === "/rest/people" && req.method === "POST") {
      seen.people.push(body);
      return send(201, { data: { createPerson: { id: "p_new" } } });
    }
    if (url.pathname === "/rest/notes") {
      seen.notes.push(body);
      return send(201, { data: { createNote: { id: "n_1" } } });
    }
    if (url.pathname === "/rest/noteTargets") {
      seen.targets.push(body);
      return send(201, { data: { createNoteTarget: { id: "nt_1" } } });
    }
    send(404, { statusCode: 404, messages: ["Not found"] });
  });
}

const KEY = "k".repeat(40);
let app: INestApplication;
let stop: () => Promise<void>;
let tw: Server;
beforeAll(async () => {
  tw = fakeTwenty();
  await new Promise<void>((r) => tw.listen(0, "127.0.0.1", r));
  process.env.TWENTY_API_URL = `http://127.0.0.1:${(tw.address() as AddressInfo).port}`;
  process.env.INTEGRATIONS_KEY = "ef".repeat(32);
  process.env.AGENT_RUNTIME_KEY = KEY;
  process.env.LIVEKIT_URL = "";
  ({ app, stop } = await startApp());
});
afterAll(async () => {
  await stop();
  tw.close();
});

const signedPost = (path: string, body: object) => {
  const raw = JSON.stringify(body);
  return request(app.getHttpServer()).post(path).set("content-type", "application/json").set("x-runtime-signature", signRuntime(KEY, "POST", path, raw)).send(raw);
};

async function liveCall(w: { agent: request.Agent; ws: string; id: string }) {
  const agents: Model<{ draft: Record<string, unknown> }> = app.get(getModelToken("Agent"));
  const flowId = (await w.agent.get(`${w.ws}/agents`)).body[0].id;
  const a = (await agents.findById(flowId).lean())!;
  const calls: Model<unknown> = app.get(getModelToken("Call"));
  const draft = { ...a.draft, agent: { ...(a.draft.agent as object), name: "Sara" }, timezone: "Australia/Sydney", steps: [], dataFields: [] };
  const call = (await calls.create({ workspaceId: new Types.ObjectId(w.id), agentId: new Types.ObjectId(flowId), direction: "inbound", startedAt: new Date(), live: true, test: true, fromNumber: "+61400111222", config: draft })) as unknown as { _id: Types.ObjectId };
  return String(call._id);
}

describe("Twenty", () => {
  it("connects to Twenty with a key it accepts, and refuses one it doesn't", async () => {
    const { agent, ws } = await withWorkspace(app, "tw1@example.com");
    expect((await agent.put(`${ws}/integrations/twenty`).send({ apiKey: "tw-wrong-key" }).expect(422)).body.error.message).toMatch(/didn't accept that key/);
    const res = await agent.put(`${ws}/integrations/twenty`).send({ apiKey: "tw-good-key" }).expect(200);
    expect(res.body).toMatchObject({ id: "twenty", connected: true, account: expect.stringMatching(/^127\.0\.0\.1:\d+$/) });
  });

  it("a self-hosted address must be public https: private networks and plain http are refused", async () => {
    const { agent, ws } = await withWorkspace(app, "tw2@example.com");
    expect((await agent.put(`${ws}/integrations/twenty`).send({ apiKey: "tw-good-key", accountId: "http://crm.example.com" }).expect(502)).body.error.message).toMatch(/https/);
    expect((await agent.put(`${ws}/integrations/twenty`).send({ apiKey: "tw-good-key", accountId: "https://127.0.0.1:9" }).expect(502)).body.error.message).toMatch(/private|public|isn't allowed|local/i);
    expect((await agent.get(`${ws}/integrations`)).body).toEqual([]);
  });

  it("saves the caller as a person (split phone) with a note linked to them", async () => {
    const w = await withWorkspace(app, "tw3@example.com", { sample: true });
    await w.agent.put(`${w.ws}/integrations/twenty`).send({ apiKey: "tw-good-key" }).expect(200);
    const callId = await liveCall(w);
    const res = await signedPost(`/runtime/calls/${callId}/crm`, { provider: "twenty", saved: { contactName: "Ann Lee" } }).expect(200);
    expect(res.body.text).toBe("saved Ann Lee to Twenty, with a note of the call (test call, really saved)");
    expect(seen.filters).toContain("phones.primaryPhoneNumber[eq]:'400111222'");
    expect(seen.people.at(-1)).toEqual({ name: { firstName: "Ann", lastName: "Lee" }, phones: { primaryPhoneNumber: "400111222", primaryPhoneCountryCode: "AU", primaryPhoneCallingCode: "+61" } });
    expect(seen.notes.at(-1)).toMatchObject({ title: "Phone call with Sara: in progress", bodyV2: { markdown: expect.stringMatching(/Answers:\n- .*: Ann Lee/) } });
    expect(seen.targets.at(-1)).toEqual({ noteId: "n_1", targetPersonId: "p_new" });
  });

  it("finds a person already there by email instead of adding them again", async () => {
    const w = await withWorkspace(app, "tw4@example.com", { sample: true });
    await w.agent.put(`${w.ws}/integrations/twenty`).send({ apiKey: "tw-good-key" }).expect(200);
    const callId = await liveCall(w);
    const before = seen.people.length;
    await signedPost(`/runtime/calls/${callId}/crm`, { provider: "twenty", saved: { contactName: "Known Person", email: "known@x.com" } }).expect(200);
    expect(seen.people.length).toBe(before);
    expect(seen.targets.at(-1)).toEqual({ noteId: "n_1", targetPersonId: "p_known" });
  });
});
