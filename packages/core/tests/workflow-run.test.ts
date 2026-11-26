import { describe, expect, it } from "vitest";
import { describePosition, nextStep } from "../src/workflow-run";
import type { Step } from "../src/types";

const steps: Step[] = [
  { id: "hello", kind: "say", text: "Checking in on your {car_model}." },
  { id: "q1", kind: "ask", question: "Is everything running well?", field: "all_good", answerType: "yesno" },
  { id: "b1", kind: "branch", condition: { field: "all_good", op: "is_no" }, yes: [{ id: "q2", kind: "ask", question: "What's been happening?", field: "problem", answerType: "text" }, { id: "a1", kind: "action", action: "crm", detail: "Flag {problem}" }], no: [] },
  { id: "q3", kind: "ask", question: "Book a service?", field: "wants_service", answerType: "choice", choices: ["Yes", "Later"] },
  { id: "b2", kind: "branch", condition: { field: "wants_service", op: "is", value: "Yes" }, yes: [{ id: "a2", kind: "action", action: "book", detail: "1 hour slot" }, { id: "e1", kind: "end", outcome: "service_booked", text: "You're all set." }], no: [{ id: "e2", kind: "end", outcome: "not_now", text: "No problem, bye." }] },
];

describe("nextStep", () => {
  it("starts with the lines to say and the first question, filled in", () => {
    const p = nextStep(steps, { car_model: "Corolla" });
    expect(p.say).toEqual([{ id: "hello", text: "Checking in on your Corolla." }]);
    expect(p.next).toMatchObject({ kind: "ask", question: "Is everything running well?" });
  });

  it("doesn't repeat what was said, follows the branch, and stops at an action until it's done", () => {
    const p = nextStep(steps, { all_good: "No" }, new Set(["hello"]));
    expect(p.say).toEqual([]);
    expect(p.next).toMatchObject({ kind: "ask", step: { field: "problem" } });
    const q = nextStep(steps, { all_good: "No", problem: "rattle" }, new Set(["hello"]));
    expect(q.next).toMatchObject({ kind: "action", detail: "Flag rattle" });
    const r = nextStep(steps, { all_good: "No", problem: "rattle" }, new Set(["hello", "a1"]));
    expect(r.next).toMatchObject({ kind: "ask", step: { field: "wants_service" } });
  });

  it("skips a question answered early and re-routes when an answer changes", () => {
    const early = nextStep(steps, { all_good: "Yes", wants_service: "Later" }, new Set(["hello"]));
    expect(early.next).toMatchObject({ kind: "end", step: { outcome: "not_now" } });
    const changed = nextStep(steps, { all_good: "Yes", wants_service: "Yes" }, new Set(["hello"]));
    expect(changed.next).toMatchObject({ kind: "action", step: { action: "book" } });
    expect(changed.path).toEqual(["hello", "q1", "b1", "q3", "b2", "a2"]);
  });

  it("says so when the workflow runs out without an ending", () => {
    const p = nextStep([{ id: "s", kind: "say", text: "Hi" }], {}, new Set(["s"]));
    expect(p.next).toEqual({ kind: "no_ending" });
    expect(describePosition(p)).toMatch(/no more steps/);
  });

  it("describes the position for the model, with the answer's format", () => {
    const p = nextStep(steps, { all_good: "Yes" }, new Set(["hello"]));
    expect(describePosition(p)).toBe('Ask: "Book a service?" Save the answer with note, field "wants_service" (one of: Yes, Later).');
  });
});
