import { describe, expect, it } from "vitest";
import { EditError, addAfterCall, addStep, addTool, changeStep, deleteStep, missingIntegrations, removeData, setCheck, setData, type EditableAgent } from "../src/agent-edits";
import { allSteps, flowIssues } from "../src/flow-tree";
import type { Step } from "../src/types";

const G = "Hi, this is Ava, the AI assistant. This call is recorded.";
const base = (): EditableAgent => ({
  name: "Leads",
  description: "",
  direction: "outbound",
  agent: { name: "Ava", voiceId: "v_ava", personality: "friendly", speed: 1, language: "English" },
  greeting: G,
  prompt: "You are Ava.",
  steps: [
    { id: "q1", kind: "ask", question: "Still interested?", field: "interested", answerType: "yesno" },
    { id: "b1", kind: "branch", condition: { field: "interested", op: "is_yes" }, yes: [{ id: "e1", kind: "end", outcome: "keen", text: "Great, bye." }], no: [{ id: "e2", kind: "end", outcome: "not_now", text: "No worries, bye." }] },
  ] as Step[],
  dataFields: [],
  askRequired: {},
  checks: [],
  tools: [],
  knowledgeIds: [],
  afterCall: [],
});

describe("steps", () => {
  it("adds after a step, inside a decision, and at the start, saying what it did", () => {
    let a = base();
    const e1 = addStep(a, { after: "q1" }, { kind: "ask", question: "What's your budget?", field: "Budget", answerType: "number", required: false });
    a = e1.agent;
    expect(e1.said).toBe("Added a step: Ask “What's your budget?”");
    expect(a.steps.map((s) => s.kind)).toEqual(["ask", "ask", "branch"]);
    expect(a.askRequired).toEqual({ budget: false });
    a = addStep(a, { inside: "b1", side: "yes" }, { kind: "action", action: "crm", detail: "Save them as a hot lead", integration: "gohighlevel" }).agent;
    const yes = (a.steps[2] as Extract<Step, { kind: "branch" }>).yes;
    expect(yes.map((s) => s.kind)).toEqual(["end", "action"]);
    a = addStep(a, { before: "e1" }, { kind: "say", text: "Love it." }).agent;
    expect((a.steps[2] as Extract<Step, { kind: "branch" }>).yes.map((s) => s.kind)).toEqual(["say", "end", "action"]);
    a = addStep(a, { at: "start" }, { kind: "say", text: "Quick one." }).agent;
    expect(a.steps[0]).toMatchObject({ kind: "say", text: "Quick one." });
  });

  it("builds a decision with its own steps", () => {
    const a = addStep(base(), { after: "q1" }, { kind: "branch", condition: { field: "interested", op: "is_no" }, yes: [{ kind: "ask", question: "Why not?", field: "reason", answerType: "text" }], no: [] }).agent;
    expect(allSteps(a.steps).filter((s) => s.kind === "ask").map((s) => (s as Extract<Step, { kind: "ask" }>).field)).toEqual(["interested", "reason"]);
  });

  it("changes only what a step has, and removes a step", () => {
    const changed = changeStep(base(), "q1", { question: "Are you still keen?", text: "ignored" });
    expect(changed.agent.steps[0]).toMatchObject({ question: "Are you still keen?", field: "interested" });
    expect(changed.said).toBe("Changed a step: Ask “Are you still keen?”");
    expect(() => changeStep(base(), "q1", { text: "x" })).toThrow(EditError);
    const removed = deleteStep(base(), "b1");
    expect(removed.agent.steps).toHaveLength(1);
    expect(removed.said).toMatch(/and the steps inside it/);
  });

  it("refuses ids that don't exist, so the AI can correct itself", () => {
    expect(() => addStep(base(), { after: "nope" }, { kind: "say", text: "x" })).toThrow(/no step with id nope/);
    expect(() => addStep(base(), { inside: "q1", side: "yes" }, { kind: "say", text: "x" })).toThrow(/no decision/);
    expect(() => deleteStep(base(), "nope")).toThrow(EditError);
  });
});

describe("the rest of the agent", () => {
  it("listens for fields, adds after-call actions, tools and checks", () => {
    let a = setData(base(), { label: "Company size", type: "number", description: "How many staff", required: true }).agent;
    expect(a.dataFields[0].key).toBe("company_size");
    a = setData(a, { key: "company_size", label: "Company size", type: "number", description: "Staff count", required: false }).agent;
    expect(a.dataFields).toHaveLength(1);
    expect(removeData(a, "company_size").agent.dataFields).toHaveLength(0);
    const ac = addAfterCall(a, { kind: "save_contact", integration: "gohighlevel", fields: ["interested"], detail: "Update the contact" });
    expect(ac.said).toBe("After the call: save the contact in GoHighLevel (interested)");
    const t = addTool(ac.agent, { kind: "integration", integration: "google_calendar", name: "Check availability", url: "", description: "When they ask for a time" });
    expect(t.said).toBe("Added a tool: Check availability (Google Calendar)");
    expect(setCheck(t.agent, { label: "Booked", description: "A time was agreed" }).agent.checks).toHaveLength(1);
  });
});

describe("integrations that aren't connected", () => {
  it("lists every use of one, and blocks going live until it's connected", () => {
    let a = addStep(base(), { before: "e1" }, { kind: "action", action: "crm", detail: "Hot lead", integration: "gohighlevel" }).agent;
    a = addAfterCall(a, { kind: "add_row", integration: "google_sheets", fields: [], detail: "Leads sheet" }).agent;
    a = addAfterCall(a, { kind: "send_webhook", integration: "webhook", fields: [], detail: "https://example.com/hook" }).agent;
    expect(missingIntegrations(a, []).map((m) => m.name)).toEqual(["GoHighLevel", "Google Sheets"]); // a webhook is only a URL
    expect(missingIntegrations(a, ["gohighlevel", "google_sheets"])).toEqual([]);
    const issues = flowIssues(a, ["interested"], ["google_sheets"]).map((i) => i.message);
    expect(issues).toEqual(["Connect GoHighLevel: “Updates the CRM” step uses it."]);
    expect(flowIssues(a, ["interested"])).toEqual([]); // not checked when the caller doesn't say what's connected
  });
});
