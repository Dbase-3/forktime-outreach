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

describe("integrations that aren't connected", () => {
  it("skips the step, says so on the transcript, and carries on", () => {
    const { runAction } = require("../src/call");
    const skipped = runAction({ action: "crm", integration: "gohighlevel" }, "Save the lead", true, []);
    expect(skipped).toMatchObject({ line: "Updates the CRM: Save the lead (skipped, GoHighLevel isn't connected)", tag: null });
    expect(runAction({ action: "crm", integration: "gohighlevel" }, "Save the lead", true, ["gohighlevel"]).tag).toBe("crm");
    expect(runAction({ action: "webhook", integration: "webhook" }, "https://x.test", true, []).tag).toBe("webhook");
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

describe("booking into a connected calendar", () => {
  const calSteps = steps.map((s) => (s.id === "b2" ? { ...s, yes: [{ ...s.yes[0], integration: "calcom" }, s.yes[1]] } : s));
  function calendarCall(book) {
    const reports = [];
    const f = { ...flow, steps: calSteps };
    const cfg = { flow: f, business: "Northside", direction: "outbound", values: { agent: "Mia", business: "Northside", car_model: "Corolla" }, schema: dataSchema(f), choices: {}, knowledge: { inline: [], searchable: false }, test: true, outcomes: ["booked", "not_now", "other"], voice: f.agent, greeting: f.greeting, maxCallMinutes: 10, connected: ["calcom"], calendar: { provider: "calcom", name: "Cal.com", eventType: "Service" } };
    const api = { report: (e) => reports.push(e), freeTimes: async () => ({ text: "Wednesday 2 December: 9 am [2026-12-02T09:00:00.000+11:00]" }), book };
    const call = new PlatformCall({ ctx: { room: {} }, api, cfg, vad: null, log: { warn() {}, log() {} } });
    call.agent = { updateInstructions() {} };
    call.note("all_good", "yes");
    return { call, reports };
  }

  it("waits at the Book step: the model is told to check times and book, nothing runs on its own", () => {
    const { call, reports } = calendarCall(async () => ({ ok: true }));
    const said = call.note("wants", "yes");
    expect(said).toMatch(/Then: Book a time with them now\..*check_times/);
    expect(call.position.next).toMatchObject({ kind: "action", step: { id: "a1" } });
    expect(reports.some((r) => r.type === "action")).toBe(false);
    expect(call.instructions()).toMatch(/Right now: Book a time with them now\./);
    expect(Object.keys(call.tools())).toEqual(expect.arrayContaining(["check_times", "book_time", "skip_booking"]));
  });

  it("a booking moves the workflow on to its ending, and is on the transcript", async () => {
    const { call, reports } = calendarCall(async (b) => ({ ok: true, when: "Wednesday 2 December at 9 am", text: "Booked", got: b }));
    call.note("wants", "yes");
    const out = await call.calendarTools().book_time.execute({ start: "2026-12-02T09:00:00.000+11:00", name: "Ann Lee" }, {});
    expect(out).toBeUndefined();
    expect(call.pending).toEqual({ type: "end", goodbye: "All set, bye!" });
    expect(reports).toContainEqual({ type: "action", action: "booked" });
    expect(reports.find((r) => r.type === "line" && r.line.who === "action").line.text).toBe("Booked in Cal.com: Wednesday 2 December at 9 am (test call, really booked)");
  });

  it("a refused booking keeps the step waiting and tells the model why", async () => {
    const { call } = calendarCall(async () => ({ ok: false, text: "This calendar needs an email address to book." }));
    call.note("wants", "yes");
    expect(await call.calendarTools().book_time.execute({ start: "x", name: "Ann" }, {})).toMatch(/needs an email/);
    expect(call.position.next.kind).toBe("action");
  });

  it("declining finishes the step and carries on", async () => {
    const { call } = calendarCall(async () => ({ ok: true }));
    call.note("wants", "yes");
    expect(await call.calendarTools().skip_booking.execute({ reason: "will call back" }, {})).toBeUndefined();
    expect(call.done.has("a1")).toBe(true);
  });
});
