import { beforeAll, describe, expect, it, vi } from "vitest";
import outcomes from "../src/outcomes.js";
import script from "../src/forkmate/script.js";
import save from "../src/forkmate/save.js";
import draft from "../src/forkmate/draft.js";

const meta = {
  kind: "outreach",
  callId: "call-9",
  attempt: 1,
  phone: "+61412345678",
  direction: "inbound",
  mode: "forkmate",
  agentName: "Sara",
  recordCalls: true,
  recordingNotice: true,
  maxCallMinutes: 8,
};

describe("the Forkmate greeting and script (owner-approved wording, 2026-11-25)", () => {
  it("greets as Forkmate's AI assistant, says the call is recorded only when it is, and asks which one", () => {
    expect(script.forkmateGreeting(meta)).toBe(
      "Hi, this is Sara, Forkmate's AI assistant. This call is recorded. Are you booking for a group, or listing a venue?",
    );
    expect(script.forkmateGreeting({ ...meta, recordCalls: false })).toBe(
      "Hi, this is Sara, Forkmate's AI assistant. Are you booking for a group, or listing a venue?",
    );
  });

  it("knows today on the Brisbane clock, for 'this Saturday'", () => {
    const text = script.buildForkmateInstructions(meta, "x", { now: new Date("2026-11-24T23:00:00Z") });
    expect(text).toContain("Today is Wednesday 25 November 2026 in Brisbane (2026-11-25).");
  });

  it("tells the model a hidden caller's 'this number' can't be used", () => {
    expect(script.buildForkmateInstructions({ ...meta, phone: "unknown" }, "x")).toContain("Their number is hidden");
    expect(script.buildForkmateInstructions(meta, "x")).not.toContain("Their number is hidden");
  });

  it("lists the same occasions as the website form", () => {
    expect(script.FORKMATE_OCCASIONS).toEqual([
      "Group dining",
      "Corporate catering",
      "Birthday parties",
      "Private events",
      "Weddings & engagements",
      "Recurring office catering",
    ]);
  });
});

describe("the next question comes from what was recorded, in the approved order", () => {
  const B = script.LINES.booking;
  const V = script.LINES.venue;
  const line = (step) => step.match(/"(.*)"$/)[1];

  it("walks the booking questions in order, word for word", () => {
    let d = {};
    const asked = [];
    const answers = [
      { occasion: "Birthday parties", occasionWords: "a birthday" },
      { location: "New Farm" },
      { guests: 30 },
      { date: "2026-12-05" },
      { budget: 1500 },
      { details: "Two vegans" },
      { name: "Sarah Lee" },
      { useCallerNumber: true },
    ];
    for (const answer of answers) {
      asked.push(line(draft.nextBookingStep(d, meta)));
      d = draft.mergeAnswers(d, answer);
    }
    expect(asked).toEqual(B);
    expect(draft.nextBookingStep(d, meta)).toBe(
      'Read it back, word for word: "That\'s a birthday for 30 on Saturday the 5th of December in New Farm, around 1,500 dollars. Is that right?"',
    );
    d = draft.mergeAnswers(d, { readBackConfirmed: true });
    expect(line(draft.nextBookingStep(d, meta))).toBe(script.LINES.bookingConsent);
    d = draft.mergeAnswers(d, { consent: true });
    expect(draft.nextBookingStep(d, meta)).toMatch(/Call save_booking now/);
  });

  it("skips what they already said, whatever order they said it in", () => {
    const d = draft.mergeAnswers({}, { occasion: "Group dining", location: "Milton", guests: 18 });
    expect(line(draft.nextBookingStep(d, meta))).toBe(B[3]);
    const venue = draft.mergeAnswers({}, { venue: "Bistro Nine", location: "Paddington", capacity: 45 });
    expect(line(draft.nextVenueStep(venue, meta))).toBe(V[3]);
  });

  it("a declined budget, dietary question or role is done; a missing one isn't", () => {
    const base = { occasion: "Group dining", location: "x", guests: 2, date: "2026-12-05" };
    expect(line(draft.nextBookingStep(base, meta))).toBe(B[4]);
    expect(line(draft.nextBookingStep({ ...base, noBudget: true }, meta))).toBe(B[5]);
    expect(line(draft.nextBookingStep({ ...base, noBudget: true, noDetails: true }, meta))).toBe(B[6]);
    expect(line(draft.nextVenueStep({ venue: "v", location: "x", capacity: 5, contactName: "T" }, meta))).toBe(V[4]);
    expect(line(draft.nextVenueStep({ venue: "v", location: "x", capacity: 5, contactName: "T", noRole: true }, meta))).toBe(V[5]);
  });

  it("asks for another number when theirs isn't the one, or is hidden", () => {
    const ready = { occasion: "Group dining", location: "x", guests: 2, date: "2026-12-05", noBudget: true, noDetails: true, name: "A" };
    expect(line(draft.nextBookingStep({ ...ready, wantsOtherNumber: true }, meta))).toBe(script.LINES.bookingOtherNumber);
    expect(line(draft.nextBookingStep(ready, { ...meta, phone: "unknown" }))).toBe(script.LINES.bookingOtherNumber);
    expect(line(draft.nextBookingStep({ ...ready, useCallerNumber: true }, { ...meta, phone: "unknown" }))).toBe(script.LINES.bookingOtherNumber);
  });

  it("leaves the budget out of the read-back when there is none, and an empty value never erases an answer", () => {
    expect(draft.bookingReadBack({ occasionWords: "an office lunch", guests: 40, date: "2026-12-18", location: "the Valley" })).toBe(
      "That's an office lunch for 40 on Friday the 18th of December in the Valley. Is that right?",
    );
    expect(draft.mergeAnswers({ name: "Sarah" }, { name: "", guests: 3 })).toEqual({ name: "Sarah", guests: 3 });
    expect(draft.spokenDate("2027-01-01")).toBe("Friday the 1st of January");
    expect(draft.spokenDate("2026-12-22")).toBe("Tuesday the 22nd of December");
  });
});

describe("saving to the Forktime API", () => {
  const ok = (reference) => ({ ok: true, status: 201, json: async () => ({ success: true, data: { reference } }) });
  const quiet = { warn: () => undefined };

  it("posts to the phone door with the key, and answers with the reference", async () => {
    const fetchImpl = vi.fn(async () => ok("FM-ABC123"));
    const out = await save.saveForkmateRequest("venue", { venue: "X" }, { baseUrl: "https://api.example", key: "k1", fetchImpl, log: quiet });
    expect(out).toEqual({ saved: true, reference: "FM-ABC123" });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.example/api/forkmate/phone/venues");
    expect(init.headers["x-forkmate-key"]).toBe("k1");
    expect(JSON.parse(init.body)).toEqual({ venue: "X" });
  });

  it("passes a refusal about an answer back in the backend's words, without retrying", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ message: ["That date has already passed. Pick today or a later date."] }) }));
    const out = await save.saveForkmateRequest("booking", {}, { baseUrl: "https://api.example", key: "k1", fetchImpl, log: quiet });
    expect(out).toEqual({ saved: false, unreachable: false, reason: "That date has already passed. Pick today or a later date." });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(save.saveReply(out)).toContain("Ask that one question again");
  });

  it("tries twice when the server fails, then says it can't be reached", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 502, json: async () => ({}) }));
    const out = await save.saveForkmateRequest("booking", {}, { baseUrl: "https://api.example", key: "k1", fetchImpl, log: quiet });
    expect(out.unreachable).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(save.saveReply(out)).toContain("can't be reached");
  });

  it("doesn't try at all without the key", async () => {
    const fetchImpl = vi.fn();
    const out = await save.saveForkmateRequest("booking", {}, { baseUrl: "https://api.example", key: "", fetchImpl, log: quiet });
    expect(out.unreachable).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("a Forkmate call", () => {
  let OutreachCall;
  let tools;
  beforeAll(async () => {
    process.env.AGENT_EVENTS_KEY = process.env.AGENT_EVENTS_KEY || "test";
    ({ OutreachCall } = (await import("../src/call.js")).default);
    tools = (await import("../src/forkmate/tools.js")).default;
  });

  it("opens with the Forkmate greeting and gets the Forkmate tools, never Sara's or the transfer", () => {
    const call = new OutreachCall({ ctx: { room: { name: "room" } }, meta: { ...meta, transferNumber: "+61400000001", openingLine: "" }, vad: null });
    expect(call.openingLine).toBe(script.forkmateGreeting(meta));
    expect(Object.keys(call.buildTools())).toEqual(["note_booking", "note_venue", "save_booking", "save_venue", "end_call"]);
    expect(call.instructionsFor()).toContain("Forkmate's AI assistant");
    expect(call.instructionsFor()).not.toContain("CALL SCRIPT");
  });

  it("a call-back from a restaurant keeps Sara's script", () => {
    const call = new OutreachCall({ ctx: { room: { name: "room" } }, meta: { ...meta, mode: "callback", openingLine: "Hi, thanks for calling back." }, vad: null });
    expect(call.openingLine).toBe("Hi, thanks for calling back.");
    expect(Object.keys(call.buildTools())).toEqual(["end_call"]);
    expect(call.instructionsFor()).toContain("CALL SCRIPT");
  });

  it("note_booking records answers and answers with the next line; save_booking sends what was recorded", async () => {
    const saved = [];
    const call = { meta, log: { warn: () => undefined }, noteLine: () => undefined };
    const t = tools.buildForkmateTools(call, { save: async (kind, body) => (saved.push({ kind, body }), { saved: true, reference: "FM-PHN001" }) });
    expect(await t.note_booking.execute({ occasion: "Birthday parties", occasionWords: "a birthday", guests: 30, location: "New Farm" }, {})).toBe('Ask, word for word: "What date?"');
    expect(await t.save_booking.execute({}, {})).toMatch(/^Not saved yet\. Ask, word for word: "What date\?"/);
    await t.note_booking.execute({ date: "2026-12-05", noBudget: true, noDetails: true, name: "Sarah Lee", useCallerNumber: true }, {});
    await t.note_booking.execute({ readBackConfirmed: true }, {});
    expect(await t.note_booking.execute({ consent: true }, {})).toMatch(/Call save_booking now/);
    expect(await t.save_booking.execute({}, {})).toContain("Saved (FM-PHN001)");
    expect(saved[0]).toEqual({
      kind: "booking",
      body: { occasion: "Birthday parties", location: "New Farm", guests: 30, date: "2026-12-05", name: "Sarah Lee", phone: "+61412345678", callId: "call-9", consent: true },
    });
    expect(call.forkmateReference).toBe("FM-PHN001");
  });

  it("a refused date reopens the date and the consent, so it is asked and agreed again", async () => {
    const call = { meta, log: { warn: () => undefined }, noteLine: () => undefined };
    const t = tools.buildForkmateTools(call, { save: async () => ({ saved: false, unreachable: false, reason: "That date has already passed." }) });
    await t.note_booking.execute({ occasion: "Group dining", location: "x", guests: 4, date: "2026-11-01", noBudget: true, noDetails: true, name: "A", useCallerNumber: true, readBackConfirmed: true, consent: true }, {});
    expect(await t.save_booking.execute({}, {})).toContain("Not saved: That date has already passed.");
    expect(await t.note_booking.execute({}, {})).toBe('Ask, word for word: "What date?"');
  });

  it("saves a venue with the number they gave, and files the call without speaking", async () => {
    const saved = [];
    const call = { meta, log: { warn: () => undefined }, noteLine: () => undefined };
    const t = tools.buildForkmateTools(call, { save: async (kind, body) => (saved.push(body), { saved: true, reference: "FM-V1" }) });
    await t.note_venue.execute({ venue: "The Corner Table", location: "Valley", capacity: 60, contactName: "Tom", noRole: true, phone: "07 3333 4444", noDetails: true, consent: true }, {});
    await t.save_venue.execute({}, {});
    expect(saved[0]).toMatchObject({ venue: "The Corner Table", phone: "07 3333 4444", capacity: 60 });
    expect(saved[0].role).toBeUndefined();
    expect(
      await t.end_call.execute({ goodbye: "Thanks, Tom. We'll be in touch about the Brisbane pilot.", outcome: "forkmate_venue", summary: "Tom listed The Corner Table.", restaurantName: "The Corner Table" }, {}),
    ).toBeUndefined();
    expect(call.filed).toMatchObject({ outcome: "forkmate_venue", restaurantName: "The Corner Table" });
    expect(call.pending).toEqual({ type: "end", goodbye: "Thanks, Tom. We'll be in touch about the Brisbane pilot." });
  });

  it("a hidden caller's 'this number' can't be used: the number they give is", () => {
    expect(tools.chosenNumber({ phone: "unknown" }, { useCallerNumber: true, phone: "0412 111 222" })).toBe("0412 111 222");
    expect(tools.chosenNumber(meta, { useCallerNumber: true })).toBe("+61412345678");
  });

  it("every Forkmate outcome is one the app knows", () => {
    for (const outcome of tools.FORKMATE_OUTCOMES) expect(outcomes.AGENT_OUTCOMES).toContain(outcome);
    expect(outcomes.filedOutcome({ outcome: "forkmate_booking", ownerReached: null })).toBe("forkmate_booking");
  });
});
