import type { INestApplication } from "@nestjs/common";
import { getModelToken } from "@nestjs/mongoose";
import { Types } from "mongoose";
import { startApp, withWorkspace } from "./helpers";

let app: INestApplication;
let stop: () => Promise<void>;
beforeAll(async () => ({ app, stop } = await startApp()));
afterAll(() => stop());

async function numberFor(agent: Awaited<ReturnType<typeof withWorkspace>>["agent"], ws: string) {
  const offers = (await agent.post(`${ws}/numbers/search`).send({ country: "AU", kind: "local", area: "2" }).expect(201)).body;
  return (await agent.post(`${ws}/numbers`).send({ country: "AU", kind: "local", area: "2", e164: offers[0].e164 }).expect(201)).body;
}

describe("agents", () => {
  it("creates from a template or from scratch, with the workspace's time zone", async () => {
    const { agent, ws } = await withWorkspace(app, "a1@example.com");
    const fromTemplate = (await agent.post(`${ws}/agents`).send({ templateId: "front_desk", name: "Desk" }).expect(201)).body;
    expect(fromTemplate).toMatchObject({ name: "Desk", status: "draft", timezone: "Australia/Sydney", version: 1 });
    expect(fromTemplate.steps.length).toBeGreaterThan(0);
    const blank = (await agent.post(`${ws}/agents`).send({ name: "Golden Falcon" }).expect(201)).body;
    expect(blank.steps).toEqual([]);
    await agent.post(`${ws}/agents`).send({ templateId: "nope" }).expect(422);
  });

  it("goes live only through the same checks as the screen, and needs a number", async () => {
    const { agent, ws } = await withWorkspace(app, "a2@example.com");
    const a = (await agent.post(`${ws}/agents`).send({ templateId: "front_desk", name: "Desk" })).body;
    const noNumber = await agent.post(`${ws}/agents/${a.id}/publish`).send({ version: a.version }).expect(422);
    expect(noNumber.body.error.details.issues[0]).toMatch(/phone number/);
    const n = await numberFor(agent, ws);
    const withNumber = (await agent.put(`${ws}/agents/${a.id}/number`).send({ version: a.version, numberId: n.id }).expect(200)).body;
    const live = (await agent.post(`${ws}/agents/${a.id}/publish`).send({ version: withNumber.version }).expect(201)).body;
    expect(live.status).toBe("live");
    expect(live.publishedVersionId).toBeTruthy();
    const versions = (await agent.get(`${ws}/agents/${a.id}/versions`).expect(200)).body;
    expect(versions.map((v: { n: number }) => v.n)).toEqual([1]);
    // An honest greeting is required.
    const edited = (await agent.patch(`${ws}/agents/${a.id}`).send({ version: live.version, draft: { greeting: "Hi there!" } }).expect(200)).body;
    const refused = await agent.post(`${ws}/agents/${a.id}/publish`).send({ version: edited.version }).expect(422);
    expect(refused.body.error.details.issues.join(" ")).toMatch(/AI assistant/);
  });

  it("one agent per number, enforced by the database, and a live agent keeps its number", async () => {
    const { agent, ws } = await withWorkspace(app, "a3@example.com");
    const n = await numberFor(agent, ws);
    const a = (await agent.post(`${ws}/agents`).send({ templateId: "front_desk", name: "Desk", numberId: n.id }).expect(201)).body;
    const b = (await agent.post(`${ws}/agents`).send({ name: "Second" }).expect(201)).body;
    const taken = await agent.put(`${ws}/agents/${b.id}/number`).send({ version: b.version, numberId: n.id }).expect(409);
    expect(taken.body.error.message).toMatch(/belongs to Desk/);
    await agent.post(`${ws}/agents`).send({ name: "Third", numberId: n.id }).expect(409);
    const live = (await agent.post(`${ws}/agents/${a.id}/publish`).send({ version: a.version }).expect(201)).body;
    await agent.put(`${ws}/agents/${a.id}/number`).send({ version: live.version, numberId: null }).expect(409);
    await agent.delete(`${ws}/numbers/${n.id}`).expect(409); // in use
  });

  it("saves drafts with a version, and validates them", async () => {
    const { agent, ws } = await withWorkspace(app, "a4@example.com");
    const a = (await agent.post(`${ws}/agents`).send({ name: "Draft" })).body;
    const saved = (await agent.patch(`${ws}/agents/${a.id}`).send({ version: a.version, draft: { prompt: "You are {agent}." } }).expect(200)).body;
    expect(saved.version).toBe(a.version + 1);
    await agent.patch(`${ws}/agents/${a.id}`).send({ version: a.version, draft: { prompt: "Old tab" } }).expect(409);
    await agent.patch(`${ws}/agents/${a.id}`).send({ version: saved.version, draft: { agent: { ...a.agent, speed: 3 } } }).expect(422);
  });

  it("duplicates as a draft with no number; deleting frees the number but not while a campaign runs", async () => {
    const { agent, ws, id } = await withWorkspace(app, "a5@example.com");
    const n = await numberFor(agent, ws);
    const a = (await agent.post(`${ws}/agents`).send({ templateId: "front_desk", name: "Desk", numberId: n.id })).body;
    const copy = (await agent.post(`${ws}/agents/${a.id}/duplicate`).expect(201)).body;
    expect(copy).toMatchObject({ name: "Desk copy", status: "draft" });
    expect(copy.numberId).toBeUndefined();
    const campaigns = app.get(getModelToken("Campaign"));
    await campaigns.create({ workspaceId: new Types.ObjectId(id), status: "running", config: { name: "Calling", agentId: a.id } });
    const blocked = await agent.delete(`${ws}/agents/${a.id}`).expect(409);
    expect(blocked.body.error.message).toMatch(/Calling/);
    await campaigns.updateMany({}, { $set: { status: "paused" } });
    await agent.delete(`${ws}/agents/${a.id}`).expect(200);
    await agent.get(`${ws}/agents/${a.id}`).expect(404);
    // The number is free again.
    const c = (await agent.post(`${ws}/agents`).send({ name: "Takes it", numberId: n.id }).expect(201)).body;
    expect(c.numberId).toBe(n.id);
  });
});

describe("fields", () => {
  it("won't remove a field in use, and asks before changing a used field's type", async () => {
    const { agent, ws } = await withWorkspace(app, "f1@example.com", { sample: true });
    const del = await agent.delete(`${ws}/fields/purchase_date`).expect(409);
    expect(del.body.error.details.uses.join(" ")).toMatch(/when to call/);
    await agent.patch(`${ws}/fields/purchase_date`).send({ type: "text" }).expect(409);
    await agent.patch(`${ws}/fields/purchase_date`).send({ type: "text", confirm: true }).expect(200);
    await agent.post(`${ws}/fields`).send({ key: "phone", label: "Phone", type: "text" }).expect(409);
    await agent.post(`${ws}/fields`).send({ key: "favourite_colour", label: "Favourite colour", type: "text" }).expect(201);
    await agent.delete(`${ws}/fields/favourite_colour`).expect(200);
  });
});
