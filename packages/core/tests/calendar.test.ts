import { describe, expect, it } from "vitest";
import { addDays, bookingCalendarOf, dateIn, describeSlots, hasLiveBookingStep, isLiveBooking, timeLabel, whenLabel } from "../src/calendar";
import { callInstructions, type CallSetup } from "../src/call-instructions";
import { nextStep } from "../src/workflow-run";
import type { Step } from "../src/types";

const steps: Step[] = [
  { id: "q1", kind: "ask", question: "Want to book a visit?", field: "wants", answerType: "yesno" },
  {
    id: "b1",
    kind: "branch",
    condition: { field: "wants", op: "is_yes" },
    yes: [
      { id: "bk", kind: "action", action: "book", detail: "30 minute visit", integration: "calcom" },
      { id: "e1", kind: "end", outcome: "booked", text: "See you then!" },
    ],
    no: [{ id: "e2", kind: "end", outcome: "not_now", text: "No worries." }],
  },
];

describe("which calendar an agent books into", () => {
  it("a Book step or a tool on a connected calendar", () => {
    expect(bookingCalendarOf({ steps }, ["calcom"])).toBe("calcom");
    expect(bookingCalendarOf({ steps }, [])).toBeNull();
    expect(bookingCalendarOf({ steps: [], tools: [{ id: "t", kind: "integration", name: "Check my calendar", url: "", description: "", integration: "calcom" }] }, ["calcom"])).toBe("calcom");
    expect(bookingCalendarOf({ steps: [{ id: "a", kind: "action", action: "crm", detail: "", integration: "calcom" }] }, ["calcom"])).toBeNull();
  });

  it("finds a live Book step inside a decision", () => {
    expect(hasLiveBookingStep(steps, "calcom")).toBe(true);
    expect(hasLiveBookingStep(steps, "google_calendar")).toBe(false);
    expect(isLiveBooking(steps[0], "calcom")).toBe(false);
  });
});

describe("times in words", () => {
  const tz = "Australia/Sydney";
  it("says times the way people do, in the agent's time zone", () => {
    expect(timeLabel("2026-12-01T22:00:00Z", tz)).toBe("9 am");
    expect(timeLabel("2026-12-02T03:30:00Z", tz)).toBe("2:30 pm");
    expect(whenLabel("2026-12-01T22:00:00Z", tz)).toBe("Wednesday 2 December at 9 am");
  });

  it("lists a few days in order, each time with the exact value to book it, thinned out across the day", () => {
    const day = (d: string, hours: number[]) => hours.map((h) => `2026-12-0${d}T${String(h).padStart(2, "0")}:00:00.000+11:00`);
    const text = describeSlots([...day("3", [9, 10]), ...day("2", [9, 10, 11, 12, 13, 14, 15, 16]), ...day("4", [9]), ...day("5", [9])], tz, { days: 3, perDay: 4 });
    const lines = text.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe("Wednesday 2 December: 9 am [2026-12-02T09:00:00.000+11:00], 11 am [2026-12-02T11:00:00.000+11:00], 2 pm [2026-12-02T14:00:00.000+11:00], 4 pm [2026-12-02T16:00:00.000+11:00]");
    expect(lines[1]).toMatch(/^Thursday 3 December: 9 am .*, 10 am /);
    expect(describeSlots([], tz)).toBe("");
  });

  it("dates move by calendar days", () => {
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(dateIn("Australia/Sydney", new Date("2026-11-27T14:00:00Z"))).toBe("2026-11-28");
  });
});

describe("the instructions at a Book step", () => {
  const setup = (calendar: CallSetup["calendar"]): CallSetup => ({
    flow: { name: "Clinic", agent: { name: "Maya", voiceId: "v_ava", speed: 1, language: "English", personality: "friendly" } as CallSetup["flow"]["agent"], prompt: "", greeting: "", steps, timezone: "Australia/Sydney" },
    business: "Bright Smile",
    direction: "outbound",
    values: { agent: "Maya", business: "Bright Smile" },
    schema: [],
    knowledge: { inline: [], searchable: false },
    test: false,
    calendar,
  });
  const at = nextStep(steps, { wants: "Yes" });

  it("tells the model to check times and book when the calendar is connected", () => {
    const text = callInstructions(setup({ provider: "calcom", name: "Cal.com" }), at);
    expect(at.next.kind).toBe("action");
    expect(text).toContain("Right now: Book a time with them now.");
    expect(text).toContain("# Booking");
  });

  it("says nothing about booking without one", () => {
    const text = callInstructions(setup(null), nextStep(steps, {}));
    expect(text).not.toContain("# Booking");
    expect(text).not.toContain("check_times");
  });
});
