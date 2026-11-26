import { describe, expect, it } from "vitest";
import { callInstructions, callOutcomes, noteValue, type CallSetup } from "../src/call-instructions";
import { dataSchema } from "../src/agent-data";
import { nextStep } from "../src/workflow-run";
import type { Flow, Step } from "../src/types";

const steps: Step[] = [
  { id: "q1", kind: "ask", question: "How many people, {first_name}?", field: "party", answerType: "number" },
  { id: "e1", kind: "end", outcome: "booked", text: "See you then." },
];
const flow: Pick<Flow, "name" | "agent" | "prompt" | "greeting" | "steps" | "timezone" | "dataFields" | "askRequired"> = {
  name: "Bookings",
  agent: { name: "Mia", voiceId: "v_mia", personality: "friendly", speed: 1, language: "English" },
  prompt: "You are {agent} at {business}. Help with bookings.",
  greeting: "Hi, this is {agent}, the AI assistant. This call is recorded.",
  steps,
  timezone: "Australia/Sydney",
  dataFields: [{ key: "occasion", label: "Occasion", type: "text", description: "Any special occasion", required: false }],
  askRequired: {},
};
const setup = (over: Partial<CallSetup> = {}): CallSetup => ({
  flow,
  business: "Harbour Bistro",
  direction: "inbound",
  values: { agent: "Mia", business: "Harbour Bistro", today: "Thursday 26 November 2026", first_name: "Sam" },
  schema: dataSchema(flow),
  knowledge: { inline: [{ name: "Hours", text: "Open 5 till late." }], searchable: false },
  test: true,
  ...over,
});

describe("callInstructions", () => {
  it("has the owner's prompt filled in, the call's facts, the current step and the knowledge", () => {
    const text = callInstructions(setup(), nextStep(steps, { first_name: "Sam" }));
    expect(text).toMatch(/^You are Mia at Harbour Bistro\./);
    expect(text).toMatch(/They called you\./);
    expect(text).toMatch(/first_name: Sam/);
    expect(text).toMatch(/Right now: Ask: "How many people, Sam\?" Save the answer with note, field "party" \(digits only\)\./);
    expect(text).toMatch(/occasion: Any special occasion/);
    expect(text).toMatch(/<document name="Hours">\nOpen 5 till late\./);
    expect(text).toMatch(/test call/);
  });

  it("points to search when the knowledge is too big to include", () => {
    const text = callInstructions(setup({ knowledge: { inline: [], searchable: true } }), nextStep(steps, {}));
    expect(text).toMatch(/call search_knowledge first/);
  });

  it("offers the workflow's endings plus the standard ones", () => {
    expect(callOutcomes(flow)).toEqual(["booked", "not_interested", "call_back_later", "do_not_call", "wrong_number", "voicemail", "other"]);
  });
});

describe("noteValue", () => {
  it("puts answers in the field's format or says what's wrong", () => {
    expect(noteValue({ type: "yesno", label: "Happy" }, "yeah sure")).toEqual({ ok: true, value: "Yes" });
    expect(noteValue({ type: "yesno", label: "Happy" }, "maybe")).toMatchObject({ ok: false });
    expect(noteValue({ type: "number", label: "Party" }, "about eight")).toEqual({ ok: true, value: "8" });
    expect(noteValue({ type: "number", label: "Party" }, "1,200")).toEqual({ ok: true, value: "1200" });
    expect(noteValue({ type: "choice", label: "Kind", choices: ["Booking", "Cancel"] }, "a booking please")).toEqual({ ok: true, value: "Booking" });
    expect(noteValue({ type: "choice", label: "Kind", choices: ["Booking", "Cancel"] }, "lunch")).toMatchObject({ ok: false });
    expect(noteValue({ type: "date", label: "Day" }, "next Friday")).toMatchObject({ ok: false });
    expect(noteValue({ type: "date", label: "Day" }, "2026-12-04")).toEqual({ ok: true, value: "2026-12-04" });
    expect(noteValue({ type: "text", label: "Note" }, "  ")).toMatchObject({ ok: false });
  });
});
