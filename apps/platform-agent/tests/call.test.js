import { describe, expect, it } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { PlatformCall } = require("../src/call");
const { callIdFrom } = require("../src/agent");
const { parseWrapUp } = require("../src/wrapup");
const { dataSchema } = require("@outreach/core/agent-data");

const steps = [
  { id: "hi", kind: "say", text: "Quick check on your {car_model}." },
  { id: "q1", kind: "ask", question: "All good so far?", field: "all_good", answerType: "yesno" },
  { id: "b", kind: "branch", condition: { field: "all_good", op: "is_no" }, yes: [{ id: "q2", kind: "ask", question: "What's wrong?", field: "problem", answerType: "text" }], no: [] },
  { id: "q3", kind: "ask", question: "Book a service?", field: "wants", answerType: "yesno" },
  { id: "b2", kind: "branch", condition: { field: "wants", op: "is_yes" }, yes: [{ id: "a1", kind: "action", action: "book", detail: "1 hour" }, { id: "e1", kind: "end", outcome: "booked", text: "All set, bye!" }], no: [{ id: "e2", kind: "end", outcome: "not_now", text: "No worries, bye!" }] },
];
const flow = { name: "Check", agent: { name: "Mia", voiceId: "v_mia", personality: "friendly", speed: 1, language: "English" }, prompt: "You are {agent}.", greeting: "Hi, Mia the AI assistant, this call is recorded.", steps, timezone: "Australia/Sydney", dataFields: [{ key: "mood", label: "Mood", type: "text", description: "How they feel", required: false }], askRequired: {} };

function makeCall() {
  const reports = [];
  const cfg = { flow, business: "Northside", direction: "outbound", values: { agent: "Mia", business: "Northside", car_model: "Corolla" }, schema: dataSchema(flow), choices: {}, knowledge: { inline: [], searchable: false }, test: true, outcomes: ["booked", "not_now", "other"], voice: flow.agent, greeting: flow.greeting, maxCallMinutes: 10 };
  const call = new PlatformCall({ ctx: { room: {} }, api: { report: (e) => reports.push(e) }, cfg, vad: null, log: { warn() {} } });
  call.agent = { updateInstructions() {} };
  return { call, reports };
}

describe("the workflow on a call", () => {
  it("starts on the first question, with the say step in the instructions", () => {
    const { call } = makeCall();
    expect(call.instructions()).toMatch(/Right now: Say: "Quick check on your Corolla\." Then Ask: "All good so far\?"/);
  });

  it("notes an answer, follows the branch and says what to ask next", () => {
    const { call, reports } = makeCall();
    expect(call.note("all_good", "nah not really")).toBe('Saved all_good = No. Then ask: "What\'s wrong?" Save the answer with note, field "problem" (their answer in a few words).');
    expect(reports).toContainEqual({ type: "saved", field: "all_good", value: "No" });
    expect(call.done.has("hi")).toBe(true); // what it was told to say has been said
  });

  it("refuses an answer that doesn't fit, so the model asks again", () => {
    const { call, reports } = makeCall();
    expect(call.note("all_good", "hmm maybe")).toMatch(/needs Yes or No/);
    expect(reports.some((r) => r.type === "saved")).toBe(false);
  });

  it("runs the action in code and leaves the ending to the call (no reply from the model)", () => {
    const { call, reports } = makeCall();
    call.note("all_good", "yes");
    expect(call.note("wants", "yes please")).toBeUndefined();
    expect(call.pending).toEqual({ type: "end", goodbye: "All set, bye!" });
    expect(call.filed.outcome).toBe("booked");
    expect(reports).toContainEqual({ type: "action", action: "booked" });
    expect(reports.find((r) => r.type === "line" && r.line.who === "action").line.text).toMatch(/test call, nothing was really done/);
    expect(reports.filter((r) => r.type === "step").pop().path).toEqual(["hi", "q1", "b", "q3", "b2", "a1", "e1"]);
  });

  it("saves listen-for fields without moving the workflow", () => {
    const { call } = makeCall();
    expect(call.note("mood", "Pretty happy")).toBe("Saved mood. Carry on where you were.");
    expect(call.position.next.kind).toBe("ask");
  });
});

describe("helpers", () => {
  it("only takes calls the platform sent", () => {
    expect(callIdFrom(JSON.stringify({ kind: "platform", callId: "a".repeat(24) }))).toBe("a".repeat(24));
    expect(callIdFrom(JSON.stringify({ kind: "outreach", callId: "a".repeat(24) }))).toBeNull();
    expect(callIdFrom("nope")).toBeNull();
  });

  it("keeps only what fits from the wrap-up", () => {
    const cfg = { outcomes: ["booked", "other"] };
    const out = parseWrapUp('Sure: {"outcome":"made_up","summary":"Sam called.","data":{"mood":"Happy","extra":"x"}}', cfg, [{ key: "mood" }]);
    expect(out).toEqual({ outcome: null, summary: "Sam called.", data: { mood: "Happy" } });
    expect(parseWrapUp("no json", cfg, [])).toBeNull();
  });
});
