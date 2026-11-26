import type { INestApplication } from "@nestjs/common";
import { startApp, withWorkspace } from "./helpers";

let app: INestApplication;
let stop: () => Promise<void>;
beforeAll(async () => ({ app, stop } = await startApp()));
afterAll(() => stop());

describe("campaigns", () => {
  it("counts the audience in the database, minus do-not-call and bad numbers", async () => {
    const { agent, ws } = await withWorkspace(app, "k1@example.com", { sample: true });
    const b = (await agent.get(`${ws}/bootstrap`)).body;
    const c = b.campaigns[0];
    const before = (await agent.get(`${ws}/campaigns/${c.id}`).expect(200)).body;
    expect(before.audienceCount).toBeGreaterThan(10);
    const someone = (await agent.post(`${ws}/contacts/query`).send({ list: c.audience.list })).body.rows[0];
    const w = (await agent.get(ws)).body;
    await agent.patch(`${ws}/settings`).send({ version: w.version, settings: { ...w.settings, doNotCall: [someone.phone] } }).expect(200);
    const after = (await agent.get(`${ws}/campaigns/${c.id}`)).body;
    expect(after.audienceCount).toBe(before.audienceCount - 1);
    expect(after.skipped.doNotCall).toBe(1);
  });

  it("starts only when the checks pass, and locks who/when/agent while running", async () => {
    const { agent, ws } = await withWorkspace(app, "k2@example.com", { sample: true });
    const b = (await agent.get(`${ws}/bootstrap`)).body;
    const draftAgent = b.flows.find((f: { status: string }) => f.status === "draft");
    const live = b.flows.find((f: { status: string; direction: string }) => f.status === "live" && f.direction !== "inbound");
    const fresh = (await agent.post(`${ws}/campaigns`).send({ agentId: live.id, name: "Test run" }).expect(201)).body;
    const started = (await agent.post(`${ws}/campaigns/${fresh.id}/start`).send({ version: fresh.version }).expect(201)).body;
    expect(started.status).toBe("running");
    const locked = await agent.patch(`${ws}/campaigns/${fresh.id}`).send({ version: started.version, startHour: 10 }).expect(409);
    expect(locked.body.error.details.locked).toEqual(["startHour"]);
    await agent.patch(`${ws}/campaigns/${fresh.id}`).send({ version: started.version, name: "Renamed is fine" }).expect(200);
    if (draftAgent) {
      const bad = (await agent.post(`${ws}/campaigns`).send({ agentId: draftAgent.id })).body;
      const refused = await agent.post(`${ws}/campaigns/${bad.id}/start`).send({ version: bad.version }).expect(422);
      expect(refused.body.error.details.issues.join(" ")).toMatch(/draft/);
    }
  });
});

describe("knowledge", () => {
  it("stores text straight away and reads web pages in a job, refusing private addresses", async () => {
    const { agent, ws } = await withWorkspace(app, "k3@example.com");
    const text = (await agent.post(`${ws}/knowledge`).send({ kind: "text", name: "Hours", content: "Open 9 to 5.", availableToAll: true }).expect(201)).body;
    expect(text).toMatchObject({ status: "ready", sizeBytes: 12 });
    expect((await agent.get(`${ws}/knowledge/${text.id}`)).body.content).toBe("Open 9 to 5.");
    const web = (await agent.post(`${ws}/knowledge`).send({ kind: "url", source: "http://169.254.169.254/latest/meta-data", availableToAll: false }).expect(201)).body;
    expect(web.status).toBe("failed");
    expect(web.error).toMatch(/private network/);
    const html = (await agent.post(`${ws}/knowledge`).send({ kind: "file", name: "faq.html", content: "<h1>FAQ</h1><p>We &amp; you</p><script>x()</script>", availableToAll: false })).body;
    expect((await agent.get(`${ws}/knowledge/${html.id}`)).body.content).toMatch(/^FAQ\s+We & you$/);
  });

  it("can't delete a document an agent uses", async () => {
    const { agent, ws } = await withWorkspace(app, "k4@example.com");
    const a = (await agent.post(`${ws}/agents`).send({ name: "Desk" })).body;
    const doc = (await agent.post(`${ws}/knowledge`).send({ kind: "text", name: "Menu", content: "Pizza", availableToAll: false, attachTo: a.id })).body;
    const err = await agent.delete(`${ws}/knowledge/${doc.id}`).expect(409);
    expect(err.body.error.message).toMatch(/Desk uses it/);
  });
});

describe("CSV import job", () => {
  it("imports in batches, typed, with duplicates counted and a source recorded", async () => {
    const { agent, ws } = await withWorkspace(app, "k5@example.com");
    await agent.post(`${ws}/contacts`).send({ name: "Already", phone: "0412 555 099", groups: [], fields: {} });
    const lines = ["Name,Phone,Bought,Km"];
    for (let i = 0; i < 2500; i++) lines.push(`Person ${i},04${String(12000000 + i)},${(i % 28) + 1}/04/2026,${i * 10}`);
    lines.push("Dup,0412555099,13/04/2026,5");
    lines.push("No phone,,01/01/2026,1");
    const columns = [
      { index: 0, name: "Name", label: "Name", type: "text", target: "name" },
      { index: 1, name: "Phone", label: "Phone", type: "phone", target: "phone" },
      { index: 2, name: "Bought", label: "Bought", type: "date", target: "field:bought" },
      { index: 3, name: "Km", label: "Km", type: "number", target: "field:km" },
    ];
    const job = (await agent.post(`${ws}/imports`).send({ fileName: "buyers.csv", csv: lines.join("\n"), columns, list: "Buyers" }).expect(201)).body;
    const done = (await agent.get(`${ws}/imports/${job.id}`)).body;
    expect(done).toMatchObject({ status: "done", total: 2502, created: 2500, duplicates: 1, skipped: 1 });
    const q = (await agent.post(`${ws}/contacts/query`).send({ list: "Buyers", filter: { match: "all", rules: [{ field: "km", op: "at_least", value: "24000" }] } })).body;
    expect(q.total).toBe(100);
    expect(q.rows[0].fields.bought).toMatch(/^2026-04-\d{2}$/);
    const b = (await agent.get(`${ws}/bootstrap`)).body;
    expect(b.fieldDefs.map((f: { key: string }) => f.key)).toEqual(expect.arrayContaining(["bought", "km"]));
    expect(b.sources.find((s: { name: string }) => s.name === "buyers.csv").rows).toBe(2500);
  });
});

describe("calls, analytics and home", () => {
  it("lists calls with names, finds by caller, and saves feedback", async () => {
    const { agent, ws } = await withWorkspace(app, "k6@example.com", { sample: true });
    const page = (await agent.post(`${ws}/calls/query`).send({ pageSize: 20 }).expect(201)).body;
    expect(page.total).toBeGreaterThan(500);
    expect(page.rows[0].transcript).toEqual([]); // the list never ships transcripts
    const withContact = page.rows.find((r: { contactId: string }) => r.contactId);
    expect(page.contacts[withContact.contactId].name).toBeTruthy();
    const name = page.contacts[withContact.contactId].name.split(" ")[0];
    expect((await agent.post(`${ws}/calls/query`).send({ search: name })).body.total).toBeGreaterThan(0);
    const one = (await agent.get(`${ws}/calls/${withContact.id}`)).body;
    expect(Array.isArray(one.call.transcript)).toBe(true);
    const fb = (await agent.patch(`${ws}/calls/${withContact.id}/feedback`).send({ feedback: { rating: "down", reasons: ["robotic"], note: "Too slow", at: new Date().toISOString() } }).expect(200)).body;
    expect(fb.feedback.rating).toBe("down");
  });

  it("works out analytics and home figures on the server", async () => {
    const { agent, ws } = await withWorkspace(app, "k7@example.com", { sample: true });
    const a = (await agent.post(`${ws}/analytics`).send({ range: "30d" }).expect(201)).body;
    expect(a.now.summary.calls).toBeGreaterThan(100);
    expect(a.pickup.total).toBeGreaterThan(0);
    expect(a.byAgent.length).toBe(3);
    expect(a.bestTimes.length).toBeGreaterThan(0);
    const h = (await agent.get(`${ws}/home`).expect(200)).body;
    expect(Object.keys(h.agents)).toHaveLength(3);
    expect(h.windows["14"].perDay).toHaveLength(14);
    expect(h.recent).toHaveLength(5);
  });
});
