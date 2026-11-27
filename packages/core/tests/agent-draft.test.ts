import { describe, expect, it } from "vitest";
import { applyDraft, fieldKey, greetingIsHonest, type AgentDraftT } from "../src/agent-draft";
import { allSteps } from "../src/flow-tree";
import { TEMPLATES, flowFromTemplate } from "../src/templates";

const draft = (over: Partial<AgentDraftT> = {}): AgentDraftT => ({
  name: " Test drive follow-up ",
  summary: "Checks in after a test drive.",
  direction: "outbound",
  greeting: "Hi {first_name}, this is {agent}, the AI assistant at {business}. This call is recorded.",
  prompt: "You are {agent}.",
  steps: [
    { kind: "ask", question: "Want to buy?", field: "Wants To Buy", answerType: "yesno", choices: [] },
    {
      kind: "branch",
      condition: { field: "wants_to_buy", op: "is_yes", value: "" },
      yes: [{ kind: "action", action: "book", detail: "Sales" }, { kind: "end", outcome: "Meeting Booked", text: "Bye!" }],
      no: [{ kind: "ask", question: "Which?", field: "pick", answerType: "choice", choices: ["Only one"] }, { kind: "end", outcome: "", text: "Bye." }],
    },
  ],
  dataFields: [
    { key: "wants_to_buy", label: "Dup", type: "yesno", description: "", required: true },
    { key: "Budget", label: "Budget", type: "number", description: "If said", required: false },
  ],
  checks: [{ label: "Booked", description: "A meeting was booked" }, { label: " ", description: "" }],
  agentName: "",
  business: "",
  ...over,
});

describe("turning a written draft into an agent", () => {
  it("gives every step an id and cleans keys", () => {
    const parts = applyDraft(draft());
    const steps = allSteps(parts.steps);
    expect(new Set(steps.map((s) => s.id)).size).toBe(steps.length);
    expect(steps[0]).toMatchObject({ kind: "ask", field: "wants_to_buy" });
    const branch = parts.steps[1];
    expect(branch.kind === "branch" && branch.condition).toEqual({ field: "wants_to_buy", op: "is_yes" });
    expect(steps.find((s) => s.kind === "end" && s.outcome === "meeting_booked")).toBeTruthy();
    expect(steps.find((s) => s.kind === "end" && s.outcome === "done")).toBeTruthy();
    expect(parts.name).toBe("Test drive follow-up");
  });

  it("a choice with fewer than two options becomes a text answer", () => {
    const pick = allSteps(applyDraft(draft()).steps).find((s) => s.kind === "ask" && s.field === "pick");
    expect(pick).toMatchObject({ answerType: "text" });
    expect(pick && "choices" in pick && pick.choices).toBeFalsy();
  });

  it("drops data fields an ask already saves, and empty checks", () => {
    const parts = applyDraft(draft());
    expect(parts.dataFields.map((f) => f.key)).toEqual(["budget"]);
    expect(parts.checks.map((c) => c.label)).toEqual(["Booked"]);
  });

  it("never lets a greeting skip 'AI assistant' and 'recorded'", () => {
    expect(applyDraft(draft({ greeting: "Hey {first_name}, it's {agent} from {business}!" })).greeting).toMatch(/AI assistant.*recorded/);
    expect(applyDraft(draft({ direction: "inbound", greeting: "Hello!" })).greeting).toMatch(/^Thanks for calling/);
  });

  it("carries the name the agent uses on calls when the owner gave one", () => {
    expect(applyDraft(draft({ agentName: " Sara " })).agentName).toBe("Sara");
    expect(applyDraft(draft()).agentName).toBeUndefined(); // none given: the voice keeps its name
  });

  it("carries the company the agent speaks for, blank when it's the workspace's own", () => {
    expect(applyDraft(draft({ business: " Fork Time " })).business).toBe("Fork Time");
    expect(applyDraft(draft()).business).toBe("");
  });

  it("every template's prompt and greeting are honest and filled", () => {
    for (const t of TEMPLATES) {
      const flow = flowFromTemplate(t, new Date(), "Australia/Sydney");
      expect(greetingIsHonest(flow.greeting)).toBe(true);
      expect(flow.prompt).toMatch(/AI assistant/);
      expect(flow.timezone).toBe("Australia/Sydney");
    }
  });

  it("field keys are snake_case and start with a letter", () => {
    expect(fieldKey("Preferred Day!")).toBe("preferred_day");
    expect(fieldKey("1st visit")).toBe("f_1st_visit");
    expect(fieldKey("")).toBe("f_answer");
  });
});
