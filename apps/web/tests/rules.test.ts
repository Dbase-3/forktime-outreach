import { describe, expect, it } from "vitest";
import { describeWindow, insideCallingWindow, type CallingWindow } from "@/lib/calling-window";
import { DEFAULT_WELCOME, buildCallbackWelcome, buildOpeningLine, firstName, hasDisclosure, renderWelcome, unknownPlaceholders, welcomeProblem } from "@/lib/opening-line";
import { formatPhone, parseNumberList, spokenPhone, toE164 } from "@/lib/phone";
import { planNext, retryPlan, staleVerdict } from "@/lib/queue";

describe("parseNumberList", () => {
  it("reads one number per line, with a name on either side", () => {
    const parsed = parseNumberList(
      ["+61 8 8941 1234", "Rosie's Diner, (08) 8941 5678", "0889419999\tCorner Cafe", ""].join("\n"),
      "AU",
    );
    expect(parsed.entries).toEqual([
      { phone: "+61889411234", label: "" },
      { phone: "+61889415678", label: "Rosie's Diner" },
      { phone: "+61889419999", label: "Corner Cafe" },
    ]);
    expect(parsed.invalid).toEqual([]);
  });

  it("a number without a country code is read in the default country", () => {
    expect(toE164("416 555 0199", "CA")).toBe("+14165550199");
    expect(toE164("0412 345 678", "AU")).toBe("+61412345678");
  });

  it("keeps the first of a repeated number and reports lines it can't read", () => {
    const parsed = parseNumberList("0889411234\n+61 8 8941 1234\nthe owner\n12345", "AU");
    expect(parsed.entries.map((e) => e.phone)).toEqual(["+61889411234"]);
    expect(parsed.duplicates).toBe(1);
    expect(parsed.invalid).toEqual(["the owner", "12345"]);
  });

  it("reads a number out digit by digit, in the groups it is written in", () => {
    expect(spokenPhone("+61412345678")).toBe("oh four one two, three four five, six seven eight");
    expect(spokenPhone("+14165550199")).toBe("four one six, five five five, oh one nine nine");
  });

  it("formats a stored number for the screen", () => {
    expect(formatPhone("+61889411234")).toBe("+61 8 8941 1234");
    expect(formatPhone("not a number")).toBe("not a number");
  });
});

describe("insideCallingWindow", () => {
  const window: CallingWindow = {
    timezone: "Australia/Darwin",
    windowStart: "14:00",
    windowEnd: "17:00",
    windowDays: [1, 2, 3, 4, 5],
    enforceWindow: true,
  };
  // Darwin is UTC+9:30 all year.
  const darwin = (iso: string) => new Date(`${iso}+09:30`);

  it("is open inside the hours on a listed day, on the window's own clock", () => {
    expect(insideCallingWindow(darwin("2026-11-18T14:00:00"), window)).toBe(true);
    expect(insideCallingWindow(darwin("2026-11-18T16:59:00"), window)).toBe(true);
  });

  it("is shut before the start, at the end, and on a day not listed", () => {
    expect(insideCallingWindow(darwin("2026-11-18T13:59:00"), window)).toBe(false);
    expect(insideCallingWindow(darwin("2026-11-18T17:00:00"), window)).toBe(false);
    expect(insideCallingWindow(darwin("2026-11-21T15:00:00"), window)).toBe(false);
  });

  it("lets everything through when switched off, and nothing through when it can't be read", () => {
    expect(insideCallingWindow(darwin("2026-11-21T03:00:00"), { ...window, enforceWindow: false })).toBe(true);
    expect(insideCallingWindow(darwin("2026-11-18T15:00:00"), { ...window, windowStart: "5pm" })).toBe(false);
    expect(insideCallingWindow(darwin("2026-11-18T15:00:00"), { ...window, timezone: "Mars/Olympus" })).toBe(false);
    expect(insideCallingWindow(darwin("2026-11-18T15:00:00"), { ...window, windowStart: "17:00", windowEnd: "14:00" })).toBe(false);
  });

  it("describes itself in plain words", () => {
    expect(describeWindow(window)).toBe("2:00 PM to 5:00 PM, Mon, Tue, Wed, Thu, Fri (Australia/Darwin)");
  });
});

describe("the opening line", () => {
  const settings = {
    agentName: "Sara",
    repName: "Adil Khan",
    company: "Forktime",
    topic: "A large booking he'd like to arrange.",
    recordCalls: true,
    recordingNotice: true,
  };

  it("opens with the booking enquiry before it asks for anyone", () => {
    expect(buildOpeningLine(settings)).toBe(
      "Hi, this is Sara calling about a large booking he'd like to arrange. " +
        "This call is recorded. Is the owner or manager around?",
    );
  });

  it("drops the recording notice when calls are not recorded or the notice is off", () => {
    expect(buildOpeningLine({ ...settings, recordCalls: false })).not.toContain("recorded");
    expect(buildOpeningLine({ ...settings, recordingNotice: false })).not.toContain("recorded");
  });

  it("keeps hasDisclosure as a compatibility check for the web-agent contract", () => {
    expect(hasDisclosure(buildOpeningLine(settings), "Adil")).toBe(true);
    expect(hasDisclosure("Hi, I'd like to make a large booking. Is the owner around?", "Adil")).toBe(true);
  });

  it("names a person by their first name", () => {
    expect(firstName("  Adil Khan ")).toBe("Adil");
    expect(firstName("Adil")).toBe("Adil");
  });
});

describe("the editable welcome messages", () => {
  const settings = { agentName: "Sara", repName: "Aadeel Khan", topic: "A large booking he'd like to arrange.", recordCalls: true, recordingNotice: true };

  it("the shipped wording leads with the booking enquiry", () => {
    expect(buildOpeningLine(settings)).toBe(
      "Hi, this is Sara calling about a large booking he'd like to arrange. This call is recorded. Is the owner or manager around?",
    );
    expect(buildCallbackWelcome(settings, true)).toBe(
      "Hi, thanks for calling back. This is Sara. I called earlier about a large booking he'd like to arrange. This call is recorded. May I ask who I'm speaking with?",
    );
    expect(buildCallbackWelcome(settings, false)).toBe("Hi, you've reached Forktime. This is Sara. This call is recorded. How can I help?");
  });

  it("an edited template is what gets said, with its placeholders filled in", () => {
    const edited = { ...settings, welcomeOutbound: "Hello! {agent} here about {topic}. Is the owner in?" };
    expect(buildOpeningLine(edited)).toBe("Hello! Sara here about a large booking he'd like to arrange. Is the owner in?");
    expect(renderWelcome("{recorded} Hi {rep}.", { ...settings, recordCalls: false })).toBe("Hi Aadeel.");
    expect(renderWelcome("Hi {nobody}", settings)).toBe("Hi {nobody}");
  });

  it("a blank or missing template falls back to the shipped wording", () => {
    expect(buildOpeningLine({ ...settings, welcomeOutbound: "" })).toBe(buildOpeningLine(settings));
    expect(buildCallbackWelcome({ ...settings, welcomeCallbackNew: undefined }, false)).toContain("you've reached Forktime");
  });

  it("accepts operator wording and refuses empty templates or typo'd placeholders", () => {
    expect(welcomeProblem(DEFAULT_WELCOME.welcomeOutbound, settings)).toBeNull();
    expect(welcomeProblem("Hi, this is {agent} calling for {rep}.", settings)).toBeNull();
    expect(welcomeProblem("Hi, AI here for {rep}, about {topc}.", settings)).toMatch(/Unknown placeholder: \{topc\}/);
    expect(welcomeProblem("   ", settings)).toMatch(/can't be empty/);
    expect(unknownPlaceholders("{agent} {rep} {x} {x} {y}")).toEqual(["x", "y"]);
  });
});

describe("planNext", () => {
  const window: CallingWindow = { timezone: "UTC", windowStart: "09:00", windowEnd: "17:00", windowDays: [1, 2, 3, 4, 5, 6, 7], enforceWindow: true };
  const now = new Date("2026-11-18T10:00:00Z");
  const base = { now, running: true, lineBusy: false, doNotCall: new Set<string>(), window };
  const call = (id: string, phone = `+6100000${id}`, notBefore: Date | null = null) => ({ _id: id, phone, notBefore });

  it("dials the oldest queued call when the line is free", () => {
    expect(planNext({ ...base, queued: [call("a"), call("b")] })).toEqual({ type: "dial", callId: "a" });
  });

  it("waits when paused, when a call is on the line, or when nothing is queued", () => {
    expect(planNext({ ...base, running: false, queued: [call("a")] })).toEqual({ type: "wait", reason: "paused" });
    expect(planNext({ ...base, lineBusy: true, queued: [call("a")] })).toEqual({ type: "wait", reason: "line_busy" });
    expect(planNext({ ...base, queued: [] })).toEqual({ type: "wait", reason: "empty" });
  });

  it("skips a number on the do-not-call list instead of dialling it", () => {
    expect(planNext({ ...base, queued: [call("a", "+61400000001"), call("b")], doNotCall: new Set(["+61400000001"]) })).toEqual({
      type: "skip",
      callId: "a",
      reason: "do_not_call",
    });
  });

  it("dials nothing outside the calling window", () => {
    expect(planNext({ ...base, now: new Date("2026-11-18T20:00:00Z"), queued: [call("a")] })).toEqual({
      type: "wait",
      reason: "outside_window",
    });
  });

  it("a retry waits for its time; a call behind it that is due goes first", () => {
    const later = new Date("2026-11-18T11:00:00Z");
    expect(planNext({ ...base, queued: [call("a", "+61400000002", later)] })).toEqual({ type: "wait", reason: "retry_pending" });
    expect(planNext({ ...base, queued: [call("a", "+61400000002", later), call("b")] })).toEqual({ type: "dial", callId: "b" });
  });
});

describe("staleVerdict", () => {
  const limits = { ringTimeoutSec: 30, maxCallMinutes: 5 };
  const now = new Date("2026-11-18T10:10:00Z");
  const ago = (seconds: number) => new Date(now.getTime() - seconds * 1000);

  it("leaves a call alone while it can still be ringing or talking", () => {
    expect(staleVerdict({ status: "dialing", startedAt: ago(60), answeredAt: null }, now, limits)).toBeNull();
    expect(staleVerdict({ status: "live", startedAt: ago(400), answeredAt: ago(390) }, now, limits)).toBeNull();
  });

  it("closes a call the agent never reported on, so the queue can move", () => {
    expect(staleVerdict({ status: "dialing", startedAt: ago(80), answeredAt: null }, now, limits)?.outcome).toBe("failed");
    expect(staleVerdict({ status: "live", startedAt: ago(700), answeredAt: ago(600) }, now, limits)?.outcome).toBe("failed");
  });
});

describe("retryPlan", () => {
  const now = new Date("2026-11-18T10:00:00Z");
  const base = { now, maxAttempts: 2, retryAfterMinutes: 60, retryable: ["no_answer"] };

  it("puts an unanswered call back in the queue for later, up to the limit", () => {
    expect(retryPlan({ ...base, outcome: "no_answer", attempt: 1 })).toEqual({ notBefore: new Date("2026-11-18T11:00:00Z") });
    expect(retryPlan({ ...base, outcome: "no_answer", attempt: 2 })).toBeNull();
  });

  it("never calls back someone who answered", () => {
    expect(retryPlan({ ...base, outcome: "not_interested", attempt: 1 })).toBeNull();
    expect(retryPlan({ ...base, outcome: "do_not_call", attempt: 1 })).toBeNull();
  });
});
