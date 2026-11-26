import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { signIn, startApp, withWorkspace } from "./helpers";

let app: INestApplication;
let stop: () => Promise<void>;
beforeAll(async () => ({ app, stop } = await startApp()));
afterAll(() => stop());

describe("signing in with an emailed code", () => {
  it("asks for a code without saying whether the email has an account", async () => {
    const res = await request(app.getHttpServer()).post("/auth/code").send({ email: "New.Person@Example.com" }).expect(200);
    expect(res.body).toEqual({ sent: true });
  });

  it("refuses a wrong code, then accepts the right one and sets an httpOnly cookie", async () => {
    const server = app.getHttpServer();
    await request(server).post("/auth/code").send({ email: "sam@example.com" });
    await request(server).post("/auth/verify").send({ email: "sam@example.com", code: "999999" }).expect(422);
    const ok = await request(server).post("/auth/verify").send({ email: "sam@example.com", code: "123456" }).expect(200);
    expect(String(ok.headers["set-cookie"])).toMatch(/ft_session=.+HttpOnly/i);
  });

  it("limits how many codes one email can ask for", async () => {
    const server = app.getHttpServer();
    for (let i = 0; i < 5; i++) await request(server).post("/auth/code").send({ email: "spam@example.com" }).expect(200);
    await request(server).post("/auth/code").send({ email: "spam@example.com" }).expect(429);
  });

  it("needs a session for everything that isn't public, and logging out ends it", async () => {
    const server = app.getHttpServer();
    await request(server).get("/me").expect(401);
    const agent = await signIn(app, "lee@example.com");
    const me = await agent.get("/me").expect(200);
    expect(me.body.user.email).toBe("lee@example.com");
    await agent.post("/auth/logout").expect(200);
    await agent.get("/me").expect(401);
  });
});

describe("workspaces and members", () => {
  it("creates a workspace with its creator as owner", async () => {
    const { agent, ws } = await withWorkspace(app, "owner@example.com");
    const w = await agent.get(ws).expect(200);
    expect(w.body).toMatchObject({ name: "Northside Motors", role: "owner", settings: { businessName: "Northside Motors", timezone: "Australia/Sydney" } });
  });

  it("keeps people out of workspaces they don't belong to", async () => {
    const { ws } = await withWorkspace(app, "a@example.com");
    const other = await signIn(app, "b@example.com");
    await other.get(ws).expect(403);
    await other.get(`${ws}/bootstrap`).expect(403);
    await other.get("/w/not-an-id").expect(403);
  });

  it("invites by email: the invitee joins on first sign-in with the invited role", async () => {
    const { agent, ws } = await withWorkspace(app, "boss@example.com");
    await agent.post(`${ws}/invites`).send({ email: "new.hire@example.com", role: "member" }).expect(201);
    const hire = await signIn(app, "new.hire@example.com");
    const w = await hire.get(ws).expect(200);
    expect(w.body.role).toBe("member");
    // Members can't change settings or invite.
    await hire.patch(`${ws}/settings`).send({ version: w.body.version, settings: w.body.settings }).expect(403);
    await hire.post(`${ws}/invites`).send({ email: "x@example.com" }).expect(403);
  });

  it("two people in one workspace edit safely (Phase 1 exit): the slower save is refused, never lost", async () => {
    const { agent: owner, ws } = await withWorkspace(app, "pair.owner@example.com", { sample: true });
    await owner.post(`${ws}/invites`).send({ email: "pair.member@example.com", role: "member" }).expect(201);
    const member = await signIn(app, "pair.member@example.com");

    // Both open the same agent, the same campaign and the same contact.
    const agentId = (await owner.get(`${ws}/agents`)).body[0].id;
    const a1 = (await owner.get(`${ws}/agents/${agentId}`)).body;
    const a2 = (await member.get(`${ws}/agents/${agentId}`)).body;
    await owner.patch(`${ws}/agents/${agentId}`).send({ version: a1.version, draft: { greeting: `${a1.greeting} (owner)` } }).expect(200);
    const late = await member.patch(`${ws}/agents/${agentId}`).send({ version: a2.version, draft: { greeting: "member's take" } }).expect(409);
    expect(late.body.error.code).toBe("stale");
    expect(late.body.error.details.current.greeting).toBe(`${a1.greeting} (owner)`); // the screen reloads with this
    expect((await member.get(`${ws}/agents/${agentId}`)).body.greeting).toBe(`${a1.greeting} (owner)`);

    const contactId = (await owner.post(`${ws}/contacts/query`).send({ pageSize: 1 })).body.rows[0].id;
    const c1 = (await owner.get(`${ws}/contacts/${contactId}`)).body;
    const c2 = (await member.get(`${ws}/contacts/${contactId}`)).body;
    await member.patch(`${ws}/contacts/${contactId}`).send({ version: c2.version, name: "Member Edit" }).expect(200);
    await owner.patch(`${ws}/contacts/${contactId}`).send({ version: c1.version, name: "Owner Edit" }).expect(409);
    expect((await owner.get(`${ws}/contacts/${contactId}`)).body.name).toBe("Member Edit");

    const campaignId = (await owner.get(`${ws}/campaigns`)).body[0].id;
    const k1 = (await owner.get(`${ws}/campaigns/${campaignId}`)).body;
    const k2 = (await member.get(`${ws}/campaigns/${campaignId}`)).body;
    await owner.patch(`${ws}/campaigns/${campaignId}`).send({ version: k1.version, name: "Owner's name" }).expect(200);
    await member.patch(`${ws}/campaigns/${campaignId}`).send({ version: k2.version, name: "Member's name" }).expect(409);
  });

  it("never leaves a workspace without an owner", async () => {
    const { agent, ws } = await withWorkspace(app, "solo@example.com");
    const me = await agent.get("/me");
    await agent.delete(`${ws}/members/${me.body.user.id}`).expect(409);
  });

  it("settings save with a version: a stale save is refused with the current settings", async () => {
    const { agent, ws } = await withWorkspace(app, "v@example.com");
    const w = (await agent.get(ws)).body;
    const next = { ...w.settings, callingStart: 10 };
    const saved = await agent.patch(`${ws}/settings`).send({ version: w.version, settings: next }).expect(200);
    expect(saved.body.settings.callingStart).toBe(10);
    const stale = await agent.patch(`${ws}/settings`).send({ version: w.version, settings: { ...next, callingStart: 11 } }).expect(409);
    expect(stale.body.error.code).toBe("stale");
    expect(stale.body.error.details.current.settings.callingStart).toBe(10);
  });

  it("a sample workspace comes with the demo agents, contacts, campaigns and calls", async () => {
    const { agent, ws } = await withWorkspace(app, "demo@example.com", { sample: true });
    const b = (await agent.get(`${ws}/bootstrap`).expect(200)).body;
    expect(b.flows.length).toBe(3);
    expect(b.flows.every((f: { numberId?: string }) => f.numberId)).toBe(true);
    expect(b.campaigns.length).toBeGreaterThan(0);
    expect(b.counts.contacts).toBeGreaterThan(30);
    expect(b.counts.calls).toBeGreaterThan(500);
    expect(b.knowledge.every((k: { content: string }) => k.content === "")).toBe(true); // content is fetched per document
    const campaignAgent = b.campaigns[0].agentId;
    expect(b.flows.some((f: { id: string }) => f.id === campaignAgent)).toBe(true);
  });
});
