import type { INestApplication } from "@nestjs/common";
import { BuilderService } from "../src/modules/builder/builder.service";
import { startApp, withWorkspace } from "./helpers";

let app: INestApplication;
let stop: () => Promise<void>;
beforeAll(async () => ({ app, stop } = await startApp()));
afterAll(() => stop());

type Call = { tool: string; input: Record<string, unknown> };
type RunnableTool = { name: string; run: (input: unknown) => Promise<string> };

/** A stand-in for the model: makes the given tool calls in order, records what each returned, then replies. */
function scriptModel(calls: Call[], reply = "Done.") {
  const heard: string[] = [];
  const service = app.get(BuilderService);
  service.client = (() => ({
    beta: {
      messages: {
        toolRunner: async (params: { tools: RunnableTool[]; messages: { content: string }[] }) => {
          heard.push(String(params.messages[params.messages.length - 1].content));
          for (const c of calls) heard.push(await params.tools.find((t) => t.name === c.tool)!.run(c.input));
          return { content: [{ type: "text", text: reply }], stop_reason: "end_turn" };
        },
      },
    },
  })) as unknown as BuilderService["client"];
  return heard;
}

async function sampleAgent(email: string) {
  const { agent, ws } = await withWorkspace(app, email, { sample: true });
  const flows = (await agent.get(`${ws}/agents`)).body as { id: string; name: string; status: string; numberId?: string }[];
  const flow = flows.find((f) => f.numberId)!;
  return { agent, ws, flow: (await agent.get(`${ws}/agents/${flow.id}`)).body };
}

describe("Change with AI", () => {
  it("returns the changed draft (not saved), the changes in plain words, and what isn't connected", async () => {
    const { agent, ws, flow } = await sampleAgent("b1@example.com");
    const firstId = flow.steps[0].id;
    const heard = scriptModel([
      { tool: "add_step", input: { position: "after", ref: firstId, step: { kind: "ask", question: "What's your budget?", field: "budget", answerType: "number" } } },
      { tool: "add_after_call", input: { kind: "save_contact", integration: "gohighlevel", fields: ["budget"], detail: "Update the contact" } },
    ], "I added a budget question and saved the contact to GoHighLevel after each call.");
    const res = (await agent.post(`${ws}/agents/${flow.id}/builder`).send({ message: "Ask their budget, and at the end save to GHL" }).expect(200)).body;

    expect(heard[0]).toMatch(/# The agent[\s\S]*Workflow:[\s\S]*# What to change\nAsk their budget/); // it sees the agent and the request
    expect(heard[0]).toMatch(/gohighlevel: GoHighLevel \(not connected\)/);
    expect(heard[2]).toMatch(/Not connected yet .*GoHighLevel/); // the model is told, and carries on
    expect(res.changes).toEqual(["Added a step: Ask “What's your budget?”", "After the call: save the contact in GoHighLevel (budget)"]);
    expect(res.reply).toMatch(/budget question/);
    expect(res.needs).toEqual([expect.objectContaining({ integration: "gohighlevel", name: "GoHighLevel" })]);
    expect(res.draft.steps[1]).toMatchObject({ kind: "ask", field: "budget" });
    // Nothing saved until the screen saves it.
    expect((await agent.get(`${ws}/agents/${flow.id}`)).body.steps[1]?.field).not.toBe("budget");

    // Saved, it can't go live until GoHighLevel is connected.
    const saved = (await agent.patch(`${ws}/agents/${flow.id}`).send({ version: flow.version, draft: res.draft }).expect(200)).body;
    const blocked = await agent.post(`${ws}/agents/${flow.id}/publish`).send({ version: saved.version }).expect(422);
    expect(blocked.body.error.details.issues).toContain("Connect GoHighLevel: After the call: save the contact uses it.");
    await agent.put(`${ws}/integrations/gohighlevel`).send({ account: "northside.gohighlevel.com" }).expect(200);
    await agent.post(`${ws}/agents/${flow.id}/publish`).send({ version: saved.version }).expect(201);
  });

  it("tells the model when a step id is wrong, and changes nothing", async () => {
    const { agent, ws, flow } = await sampleAgent("b2@example.com");
    const heard = scriptModel([{ tool: "remove_step", input: { id: "not_a_step" } }], "I couldn't find that step.");
    const res = (await agent.post(`${ws}/agents/${flow.id}/builder`).send({ message: "Remove the goodbye" }).expect(200)).body;
    expect(heard[1]).toBe("Not done: There's no step with id not_a_step.");
    expect(res.changes).toEqual([]);
    expect(res.draft.steps).toEqual(flow.steps);
  });

  it("refuses a welcome message that drops “AI assistant” or “recorded”, so the model fixes it", async () => {
    const { agent, ws, flow } = await sampleAgent("b5@example.com");
    const heard = scriptModel([
      { tool: "set_text", input: { what: "welcome", value: "Hi, this is Sara, an AI assistant from Fork Time. Quick question?" } },
      { tool: "set_text", input: { what: "welcome", value: "Hi, this is Sara, an AI assistant from Fork Time. This call is recorded. Quick question?" } },
    ]);
    const res = (await agent.post(`${ws}/agents/${flow.id}/builder`).send({ message: "Make her Sara from Fork Time" }).expect(200)).body;
    expect(heard[1]).toMatch(/^Not done: .*AI assistant.*recorded/);
    expect(res.draft.greeting).toMatch(/This call is recorded/);
    expect(res.changes).toHaveLength(1);
  });

  it("keeps other workspaces' agents out", async () => {
    const { flow } = await sampleAgent("b3@example.com");
    const other = await withWorkspace(app, "b4@example.com");
    scriptModel([]);
    await other.agent.post(`${other.ws}/agents/${flow.id}/builder`).send({ message: "Make it friendlier" }).expect(404);
  });
});
