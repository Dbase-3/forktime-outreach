import { describe, expect, it } from "vitest";
import { askedInReply, describePosition, lookahead, nextStep } from "../src/workflow-run";
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

describe("lookahead: the next line for each answer, so the model can say it in the same reply", () => {
  const flow: Step[] = [
    { id: "q1", kind: "ask", question: "Still keen?", field: "keen", answerType: "yesno" },
    {
      id: "b1",
      kind: "branch",
      condition: { field: "keen", op: "is_yes" },
      yes: [
        { id: "s1", kind: "say", text: "Love it." },
        { id: "q2", kind: "ask", question: "Which size?", field: "size", answerType: "choice", choices: ["Small", "Large"] },
        { id: "b2", kind: "branch", condition: { field: "size", op: "is", value: "Large" }, yes: [{ id: "a1", kind: "action", action: "crm", detail: "Flag big order" }], no: [] },
        { id: "q3", kind: "ask", question: "Your name, {first_name}?", field: "who", answerType: "text" },
        { id: "q4", kind: "ask", question: "Thanks {who}, best day?", field: "day", answerType: "text" },
        { id: "e1", kind: "end", outcome: "done", text: "Bye!" },
      ],
      no: [{ id: "e2", kind: "end", outcome: "not_now", text: "No worries." }],
    },
  ];
  const at = (values: Record<string, string>, done = new Set<string>()) => {
    const position = nextStep(flow, values, done);
    return lookahead(flow, values, done, position);
  };

  it("gives a yes/no question both paths: a next question with its lines, or the ending", () => {
    expect(at({ first_name: "Ann" })).toEqual({
      field: "keen",
      cases: [
        { when: "Yes", then: { kind: "ask", say: ["Love it."], question: "Which size?" } },
        { when: "No", then: { kind: "end" } },
      ],
    });
  });

  it("a choice that leads to an action waits for the result; the other goes straight on", () => {
    expect(at({ keen: "Yes", first_name: "Ann" }, new Set(["s1"]))?.cases).toEqual([
      { when: "Small", then: { kind: "ask", say: [], question: "Your name, Ann?" } },
      { when: "Large", then: { kind: "wait" } },
    ]);
  });

  it("a free answer the next line uses can't be said ahead", () => {
    // "Thanks {who}, best day?" needs their name, so it waits for the note.
    expect(at({ keen: "Yes", size: "Small", first_name: "Ann" }, new Set(["s1"]))).toBeNull();
  });

  it("gives nothing when no answer can be said ahead (all wait), or at the end", () => {
    expect(at({ keen: "Yes", size: "Small", who: "Bo", first_name: "Ann" }, new Set(["s1"]))).toEqual({
      field: "day",
      cases: [{ when: "any answer", then: { kind: "end" } }],
    });
    expect(lookahead(flow, { keen: "No" }, new Set(), nextStep(flow, { keen: "No" }))).toBeNull();
  });
});

describe("askedInReply: did the reply already ask the next question?", () => {
  it("yes when it asks it in its own words", () => {
    expect(askedInReply("Perfect, Tuesday works. Would you like to book your first free service?", "Would you like to book your first free service?")).toBe(true);
    expect(askedInReply("Great! Which day of the week suits you best?", "Which day of the week usually suits you best?")).toBe(true);
  });
  it("no when it asked something else, or nothing", () => {
    expect(askedInReply("We're open Saturday 9 to 1. Is this about a booking, a question, or something else?", "Would you like to speak with someone, or leave a message?")).toBe(false);
    expect(askedInReply("Great, thanks.", "Which day suits you best?")).toBe(false);
  });
});
