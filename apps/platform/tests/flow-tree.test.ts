import { describe, expect, it } from "vitest";
import {
  TOP, askedFields, findStep, flowIssues, insertStep, makeStep, moveStep, outcomesOf, removeStep, toFieldKey, updateStep,
} from "@/lib/flow-tree";
import type { Step } from "@/lib/types";

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

describe("flowIssues", () => {
  it("passes a complete flow", () => {
    expect(flowIssues({ greeting: "Hi", steps: tree() })).toEqual([]);
  });

  it("needs a greeting and a step", () => {
    expect(flowIssues({ greeting: " ", steps: [] }).map((i) => i.message)).toEqual(["Add what the agent says first.", "Add at least one step."]);
  });

  it("flags a decision on a field nobody asks for, unless the contact already has it", () => {
    const steps = [branch("c", "car_model", [], [])];
    expect(flowIssues({ greeting: "Hi", steps })[0]).toMatchObject({ stepId: "c" });
    expect(flowIssues({ greeting: "Hi", steps }, ["car_model"])).toEqual([]);
  });

  it("flags steps after an ending, also inside a branch", () => {
    const steps = [say("a"), branch("c", "x", [end("e", "done"), say("late")], []), ask("b", "x")];
    expect(flowIssues({ greeting: "Hi", steps }).map((i) => i.stepId)).toEqual(["late"]);
  });

  it("needs two choices for a choice question", () => {
    const steps: Step[] = [{ id: "q", kind: "ask", question: "Which?", field: "pick", answerType: "choice", choices: ["one"] }];
    expect(flowIssues({ greeting: "Hi", steps })[0].message).toMatch(/two choices/);
  });
});
