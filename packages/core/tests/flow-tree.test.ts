import { describe, expect, it } from "vitest";
import {
  TOP, askedFields, findStep, flowIssues, insertStep, makeStep, moveStep, outcomesOf, removeStep, toFieldKey, updateStep,
} from "../src/flow-tree";
import type { Step } from "../src/types";

const say = (id: string, text = "hi"): Step => ({ id, kind: "say", text });
const ask = (id: string, field: string): Step => ({ id, kind: "ask", question: `${field}?`, field, answerType: "yesno" });
const end = (id: string, outcome: string): Step => ({ id, kind: "end", outcome, text: "bye" });
const branch = (id: string, field: string, yes: Step[], no: Step[]): Step => ({ id, kind: "branch", condition: { field, op: "is_yes" }, yes, no });

const tree = (): Step[] => [say("a"), ask("b", "wants_service"), branch("c", "wants_service", [say("y1"), end("y2", "booked")], [end("n1", "not_now")])];

describe("insertStep", () => {
  it("adds at the top level", () => {
    const next = insertStep(tree(), TOP, 1, say("new"));
    expect(next.map((s) => s.id)).toEqual(["a", "new", "b", "c"]);
  });

  it("adds inside a branch side", () => {
    const next = insertStep(tree(), { branchId: "c", side: "no" }, 0, say("new"));
    const c = findStep(next, "c");
    expect(c?.kind === "branch" && c.no.map((s) => s.id)).toEqual(["new", "n1"]);
  });

  it("clamps an index past the end", () => {
    expect(insertStep([], TOP, 9, say("x")).map((s) => s.id)).toEqual(["x"]);
  });

  it("does not change the original tree", () => {
    const original = tree();
    insertStep(original, TOP, 0, say("x"));
    expect(original).toHaveLength(3);
  });
});

describe("updateStep / removeStep / moveStep", () => {
  it("updates a nested step but never its id or kind", () => {
    const next = updateStep(tree(), "y1", { text: "changed", id: "hacked", kind: "end" } as Partial<Step>);
    const step = findStep(next, "y1");
    expect(step).toMatchObject({ id: "y1", kind: "say", text: "changed" });
  });

  it("removes a nested step", () => {
    const next = removeStep(tree(), "y2");
    expect(findStep(next, "y2")).toBeNull();
    expect(findStep(next, "y1")).not.toBeNull();
  });

  it("removing a branch removes everything under it", () => {
    const next = removeStep(tree(), "c");
    expect(next.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("moves within its own list only", () => {
    expect(moveStep(tree(), "b", -1).map((s) => s.id)).toEqual(["b", "a", "c"]);
    expect(moveStep(tree(), "a", -1).map((s) => s.id)).toEqual(["a", "b", "c"]);
    const nested = moveStep(tree(), "y2", -1);
    const c = findStep(nested, "c");
    expect(c?.kind === "branch" && c.yes.map((s) => s.id)).toEqual(["y2", "y1"]);
  });
});

describe("reading a flow", () => {
  it("lists asked fields and outcomes once each", () => {
    const steps = [...tree(), ask("d", "wants_service")];
    expect(askedFields(steps)).toEqual(["wants_service"]);
    expect(outcomesOf({ steps })).toEqual(["booked", "not_now"]);
  });

  it("turns a label into a field key", () => {
    expect(toFieldKey("  Car model? ")).toBe("car_model");
    expect(toFieldKey("Next service (date)")).toBe("next_service_date");
  });

  it("makes every kind of step with a fresh id", () => {
    const a = makeStep("ask");
    const b = makeStep("ask");
    expect(a.id).not.toBe(b.id);
    expect(makeStep("branch")).toMatchObject({ kind: "branch", yes: [], no: [] });
  });
});

const G = "Hi, this is {agent}, the AI assistant at {business}. This call is recorded.";

describe("flowIssues", () => {
  it("passes a complete flow", () => {
    expect(flowIssues({ greeting: G, steps: tree() })).toEqual([]);
  });

  it("needs a greeting and a step", () => {
    expect(flowIssues({ greeting: " ", steps: [] }).map((i) => i.message)).toEqual(["Add what the agent says first.", "Add at least one step."]);
  });

  it("needs the welcome message to disclose the AI and the recording, in any supported language (B8, B9)", () => {
    expect(flowIssues({ greeting: "Hi, it's Ava from Northside!", steps: tree() })[0].message).toMatch(/AI assistant/);
    expect(flowIssues({ greeting: "Hola, soy Ava, la asistente de IA de {business}. Esta llamada se graba.", steps: tree() })).toEqual([]);
    expect(flowIssues({ greeting: "Bonjour, je suis l'assistante IA. Cet appel est enregistré.", steps: tree() })).toEqual([]);
  });

  it("flags a decision on a field nobody asks for, unless the contact already has it", () => {
    const steps = [branch("c", "car_model", [end("e1", "a")], [end("e2", "b")])];
    expect(flowIssues({ greeting: G, steps })[0]).toMatchObject({ stepId: "c" });
    expect(flowIssues({ greeting: G, steps }, ["car_model"])).toEqual([]);
  });

  it("flags a decision placed before the question that fills it (B6)", () => {
    const steps = [branch("c", "x", [end("e1", "a")], [end("e2", "b")]), ask("b", "x")];
    const issues = flowIssues({ greeting: G, steps });
    expect(issues.find((i) => i.stepId === "c")?.message).toMatch(/before the call asks/);
  });

  it("flags steps after an ending, also inside a branch", () => {
    const steps = [ask("b", "x"), branch("c", "x", [end("e", "done"), say("late")], [end("n", "no")])];
    expect(flowIssues({ greeting: G, steps }).map((i) => i.stepId)).toEqual(["late"]);
  });

  it("flags steps after a decision whose both sides end (B6)", () => {
    const steps = [ask("b", "x"), branch("c", "x", [end("e1", "a")], [end("e2", "b")]), say("never")];
    expect(flowIssues({ greeting: G, steps }).map((i) => i.stepId)).toEqual(["never"]);
  });

  it("flags a workflow where some calls never reach an End (B6)", () => {
    const steps = [ask("b", "x"), branch("c", "x", [end("e", "done")], [say("s")])];
    const issues = flowIssues({ greeting: G, steps });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ stepId: "s" });
    expect(issues[0].message).toMatch(/without an End/);
  });

  it("flags a check that doesn't fit the answer's type (B6)", () => {
    const steps: Step[] = [
      { id: "q", kind: "ask", question: "Score?", field: "score", answerType: "number" },
      { id: "c", kind: "branch", condition: { field: "score", op: "is_yes" }, yes: [end("a", "x")], no: [end("b", "y")] },
    ];
    expect(flowIssues({ greeting: G, steps })[0]).toMatchObject({ stepId: "c" });
    expect(flowIssues({ greeting: G, steps: [steps[0], { ...steps[1], condition: { field: "score", op: "less_than", value: "7" } } as Step] })).toEqual([]);
    // A contact field's type is known too.
    expect(flowIssues({ greeting: G, steps: [{ id: "c", kind: "branch", condition: { field: "km", op: "is_yes" }, yes: [end("a", "x")], no: [end("b", "y")] }] }, [{ key: "km", type: "number" }])[0]).toMatchObject({ stepId: "c" });
  });

  it("flags actions with nothing set up (B6)", () => {
    const steps: Step[] = [{ id: "t", kind: "action", action: "transfer", detail: " " }, end("e", "done")];
    expect(flowIssues({ greeting: G, steps })[0]).toMatchObject({ stepId: "t", message: "Say who to transfer to." });
  });

  it("needs two choices for a choice question", () => {
    const steps: Step[] = [{ id: "q", kind: "ask", question: "Which?", field: "pick", answerType: "choice", choices: ["one"] }, end("e", "done")];
    expect(flowIssues({ greeting: G, steps })[0].message).toMatch(/two choices/);
  });
});
