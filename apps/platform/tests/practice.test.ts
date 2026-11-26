import { describe, expect, it } from "vitest";
import { answerPractice, fill, startPractice } from "@/lib/practice";
import { TEMPLATES, flowFromTemplate } from "@/lib/templates";
import { flowIssues } from "@/lib/flow-tree";

const ctx = { agentName: "Ava", business: "Northside Motors", contactFields: { first_name: "Sarah", car_model: "RAV4" } };
const serviceFlow = () => flowFromTemplate(TEMPLATES.find((t) => t.id === "service_check") ?? null);

describe("practice run", () => {
  it("greets with the contact's details and stops at the first question", () => {
    const state = startPractice(serviceFlow(), ctx);
    expect(state.lines[0].text).toBe("Hi Sarah, this is Ava, the AI assistant at Northside Motors. This call is recorded. Have you got a minute?");
    expect(state.lines.at(-1)?.text).toBe("Is everything running well so far?");
    expect(state.waitingFor?.field).toBe("all_good");
  });

  it("takes the yes path to a booking", () => {
    let state = startPractice(serviceFlow(), ctx);
    state = answerPractice(state, "yes");
    expect(state.waitingFor?.field).toBe("wants_service");
    state = answerPractice(state, "yes");
    expect(state.outcome).toBe("service_booked");
    expect(state.lines.some((line) => line.who === "system" && line.text.startsWith("Books on calendar"))).toBe(true);
  });

  it("takes the otherwise path when there is a problem, then ends not now", () => {
    let state = startPractice(serviceFlow(), ctx);
    state = answerPractice(state, "no");
    expect(state.waitingFor?.field).toBe("problem");
    state = answerPractice(state, "the radio is broken");
    state = answerPractice(state, "no");
    expect(state.outcome).toBe("not_now");
    expect(state.values.problem).toBe("the radio is broken");
  });

  it("says so when a flow has no ending", () => {
    const state = startPractice({ greeting: "Hi", steps: [{ id: "s", kind: "say", text: "One thing" }] }, ctx);
    expect(state.outcome).toBe("no_ending");
  });

  it("ignores an answer when nothing was asked", () => {
    const done = startPractice({ greeting: "Hi", steps: [] }, ctx);
    expect(answerPractice(done, "hello")).toBe(done);
  });

  it("never speaks a raw placeholder: an empty or unknown one is left out (the editor flags typos)", () => {
    expect(fill("Hi {first_name}, {nope}", { first_name: "Sam" })).toBe("Hi Sam,");
  });
});

describe("templates", () => {
  it.each(TEMPLATES.map((t) => [t.id, t] as const))("%s builds a flow with no problems", (_id, template) => {
    const flow = flowFromTemplate(template);
    expect(flowIssues(flow, ["first_name", "car_model"])).toEqual([]);
  });

  it("every template says it is an AI and that the call is recorded", () => {
    for (const template of TEMPLATES) {
      const { greeting } = template.build();
      expect(greeting).toMatch(/AI assistant/);
      expect(greeting).toMatch(/recorded/);
    }
  });
});
