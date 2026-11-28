// The Lisna line (owner 2026-11-28): one real number every workspace has, outbound only, and
// the route that rings a phone from it. LiveKit points at a closed port, so everything up to
// placing the call is real and the dial itself fails the way an outage would.

import type { INestApplication } from "@nestjs/common";
import { getModelToken } from "@nestjs/mongoose";
import { Types, type Model } from "mongoose";
import { startApp, withWorkspace } from "./helpers";

const LINE = "+14375633151";
let app: INestApplication;
let stop: () => Promise<void>;
beforeAll(async () => {
  process.env.AGENT_RUNTIME_KEY = "k".repeat(40);
  process.env.LIVEKIT_URL = "ws://127.0.0.1:9";
  process.env.LIVEKIT_API_KEY = "test-key";
  process.env.LIVEKIT_API_SECRET = "test-secret-test-secret-test-secret";
  process.env.LISNA_LINE = LINE;
  process.env.LISNA_OUTBOUND_TRUNK = "ST_test";
  ({ app, stop } = await startApp());
});
afterAll(async () => {
  for (const k of ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET", "LISNA_LINE", "LISNA_OUTBOUND_TRUNK"]) delete process.env[k];
  await stop();
});

type Num = { id: string; e164: string; display: string; shared?: boolean; outboundOnly?: boolean };

describe("the Lisna line", () => {
  it("every workspace has it, shared and outbound only, and it can't be removed", async () => {
    const a = await withWorkspace(app, "line-a@example.com");
    const b = await withWorkspace(app, "line-b@example.com", { sample: true });
    for (const w of [a, b]) {
      const line = ((await w.agent.get(`${w.ws}/numbers`).expect(200)).body as Num[]).find((n) => n.e164 === LINE);
      expect(line).toMatchObject({ shared: true, outboundOnly: true, display: "+1 437 563 3151" });
      expect((await w.agent.delete(`${w.ws}/numbers/${line!.id}`).expect(422)).body.error.message).toMatch(/can't be removed/);
    }
    // Loading again doesn't add a second copy.
    await a.agent.get(`${a.ws}/bootstrap`).expect(200);
    expect(((await a.agent.get(`${a.ws}/numbers`)).body as Num[]).filter((n) => n.e164 === LINE)).toHaveLength(1);
  });
});

describe("calling a phone from the line", () => {
  it("needs the line on the agent, a real number not on the do-not-call list, and one call at a time", async () => {
    const w = await withWorkspace(app, "line-call@example.com", { sample: true });
    const agentId = ((await w.agent.get(`${w.ws}/agents`)).body as { id: string }[])[0].id;
    const agents: Model<unknown> = app.get(getModelToken("Agent"));
    const calls: Model<{ live: boolean; outcome: string; toNumber?: string; fromNumber?: string; test: boolean }> = app.get(getModelToken("Call"));
    const workspaces: Model<unknown> = app.get(getModelToken("Workspace"));
    const call = (to: string) => w.agent.post(`${w.ws}/agents/${agentId}/phone-call`).send({ to });

    await agents.updateOne({ _id: new Types.ObjectId(agentId) }, { $unset: { numberId: 1 } });
    expect((await call("+61400111222").expect(422)).body.error.message).toMatch(/Lisna line first/);

    const line = ((await w.agent.get(`${w.ws}/numbers`)).body as Num[]).find((n) => n.shared)!;
    await agents.updateOne({ _id: new Types.ObjectId(agentId) }, { $set: { numberId: new Types.ObjectId(line.id) } });
    expect((await call("12345").expect(422)).body.error.message).toMatch(/isn't a phone number/);
    expect((await call(LINE).expect(422)).body.error.message).toMatch(/Lisna line itself/);
    await workspaces.updateOne({ _id: new Types.ObjectId(w.id) }, { $set: { "settings.doNotCall": ["0400 999 888"] } });
    expect((await call("+61400999888").expect(422)).body.error.message).toMatch(/do-not-call/);

    // LiveKit can't be reached: a clear error, and the call is filed as failed, not left live.
    expect((await call("+61400111222").expect(502)).body.error.message).toMatch(/couldn't be placed/);
    const filed = await calls.findOne({ toNumber: "+61400111222" }).lean();
    expect(filed).toMatchObject({ live: false, outcome: "failed", fromNumber: LINE, test: true });

    // One phone call at a time per workspace.
    await calls.create({ workspaceId: new Types.ObjectId(w.id), agentId: new Types.ObjectId(agentId), direction: "outbound", fromNumber: LINE, toNumber: "+61400555666", startedAt: new Date(), live: true, test: true });
    expect((await call("+61400111222").expect(409)).body.error.message).toMatch(/going already/);
  });
});
