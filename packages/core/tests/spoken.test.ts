import { describe, expect, it } from "vitest";
import { readAnswer } from "../src/spoken";

describe("reading everyday replies in the preview", () => {
  it("yes and no in many words", () => {
    const yn = { answerType: "yesno" as const };
    for (const s of ["Yes", "yeah sure", "Yep!", "of course", "sounds good to me"]) expect(readAnswer(yn, s)).toBe("Yes");
    for (const s of ["no", "Nope.", "not really", "nah I'm good", "I don't think so"]) expect(readAnswer(yn, s)).toBe("No");
    expect(readAnswer(yn, "maybe later")).toBe("maybe later");
  });

  it("picks the choice heard in the reply", () => {
    const ask = { answerType: "choice" as const, choices: ["Booking", "Question", "Something else"] };
    expect(readAnswer(ask, "a booking please")).toBe("Booking");
    expect(readAnswer(ask, "something else really")).toBe("Something else");
    expect(readAnswer(ask, "QUESTION")).toBe("Question");
    expect(readAnswer(ask, "no idea")).toBe("no idea");
    const months = { answerType: "choice" as const, choices: ["This month", "In 1 to 3 months", "Just looking"] };
    expect(readAnswer(months, "just looking for now")).toBe("Just looking");
  });

  it("numbers in digits or words", () => {
    const n = { answerType: "number" as const };
    expect(readAnswer(n, "about 8 I'd say")).toBe("8");
    expect(readAnswer(n, "maybe a seven")).toBe("7");
    expect(readAnswer(n, "not sure")).toBe("not sure");
  });

  it("leaves text and dates as said", () => {
    expect(readAnswer({ answerType: "text" }, "  The brakes squeak ")).toBe("The brakes squeak");
    expect(readAnswer({ answerType: "date" }, "next Tuesday")).toBe("next Tuesday");
  });
});
