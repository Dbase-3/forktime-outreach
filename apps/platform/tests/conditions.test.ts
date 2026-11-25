import { describe as group, expect, it } from "vitest";
import { OPS_FOR, describe, fitOp, groupHolds, guessType, holds } from "@/lib/conditions";
import type { Condition } from "@/lib/types";

const now = new Date("2026-11-26T15:00:00");
const c = (op: Condition["op"], value?: string, value2?: string): Condition => ({ field: "f", op, value, value2 });

group("text", () => {
  it.each([
    [c("is", "corolla"), "Corolla", true],
    [c("is_not", "camry"), "Corolla", true],
    [c("contains", "roll"), "Corolla", true],
    [c("not_contains", "roll"), "Camry", true],
    [c("starts_with", "cor"), "Corolla", true],
    [c("contains", "x"), "", false],
    [c("is_not", "x"), "", true],
    [c("is_set"), "", false],
    [c("is_empty"), "  ", true],
  ] as const)("%j on %j → %s", (rule, value, expected) => expect(holds(rule, value, now)).toBe(expected));
});

group("number", () => {
  it.each([
    [c("more_than", "10000"), "12,000", true],
    [c("less_than", "5"), "5", false],
    [c("at_least", "5"), "5", true],
    [c("at_most", "5"), "6", false],
    [c("between", "10", "20"), "15", true],
    [c("between", "20", "10"), "15", true],
    [c("is", "3"), "3.0", true],
    [c("more_than", "3"), "abc", false],
  ] as const)("%j on %j → %s", (rule, value, expected) => expect(holds(rule, value, now)).toBe(expected));
});

group("date", () => {
  it.each([
    [c("more_than_days_ago", "30"), "2026-10-20", true], // 37 days ago
    [c("more_than_days_ago", "30"), "2026-11-01", false],
    [c("less_than_days_ago", "7"), "2026-11-22", true],
    [c("less_than_days_ago", "7"), "2026-12-01", false], // the future isn't "ago"
    [c("less_than_days_from_now", "7"), "2026-11-30", true],
    [c("more_than_days_from_now", "7"), "2026-12-10", true],
    [c("before", "2026-11-26"), "2026-11-25", true],
    [c("after", "2026-11-26"), "2026-11-26", false],
    [c("on", "2026-11-26"), "2026-11-26T09:30:00", true],
    [c("between", "2026-11-01", "2026-11-30"), "2026-11-15", true],
    [c("before", "2026-11-26"), "not a date", false],
  ] as const)("%j on %j → %s", (rule, value, expected) => expect(holds(rule, value, now)).toBe(expected));
});

group("yes/no and choice", () => {
  it("reads yes and no in their usual spellings", () => {
    expect(["Yes", "y", "TRUE", "1"].every((v) => holds(c("is_yes"), v))).toBe(true);
    expect(holds(c("is_no"), "no")).toBe(true);
    expect(holds(c("is_yes"), "maybe")).toBe(false);
  });

  it("matches any of / none of a list", () => {
    expect(holds(c("any_of", "Gold, Platinum"), "platinum")).toBe(true);
    expect(holds(c("none_of", "Gold, Platinum"), "Silver")).toBe(true);
    expect(holds(c("none_of", "Gold"), "")).toBe(true);
  });
});

group("groups, wording and types", () => {
  const values = { model: "RAV4", km: "500" };
  const rules: Condition[] = [{ field: "model", op: "is", value: "rav4" }, { field: "km", op: "more_than", value: "1000" }];

  it("And needs every rule, Or needs one, an empty group lets everyone in", () => {
    expect(groupHolds({ match: "all", rules }, values, now)).toBe(false);
    expect(groupHolds({ match: "any", rules }, values, now)).toBe(true);
    expect(groupHolds({ match: "all", rules: [] }, values, now)).toBe(true);
  });

  it("says each rule in plain words", () => {
    expect(describe(c("more_than_days_ago", "30"), "Purchase date")).toBe("Purchase date is more than 30 days ago");
    expect(describe(c("between", "1", "5"), "Visits")).toBe("Visits is between 1 and 5");
    expect(describe(c("any_of", "Gold,Platinum"), "Tier")).toBe("Tier is any of gold, platinum");
    expect(describe(c("is_set"), "Email")).toBe("Email has a value");
  });

  it("offers only operators that fit the field, falling back when the type changes", () => {
    expect(OPS_FOR.date).toContain("more_than_days_ago");
    expect(OPS_FOR.text).not.toContain("more_than");
    expect(fitOp("contains", "date")).toBe(OPS_FOR.date[0]);
    expect(fitOp("before", "date")).toBe("before");
  });

  it("guesses a column's type from its values", () => {
    expect(guessType(["2026-01-02", "2025-12-30"])).toBe("date");
    expect(guessType(["12", "1,200", "3.5"])).toBe("number");
    expect(guessType(["a@b.com", "x@y.io"])).toBe("email");
    expect(guessType(["+61 412 555 019", "(02) 5550 1234"])).toBe("phone");
    expect(guessType(["Yes", "no", "Y"])).toBe("yesno");
    expect(guessType(["Gold", "Silver", "Gold", "Gold", "Silver", "Gold"])).toBe("choice");
    expect(guessType(["Sarah Chen", "Tom Nguyen"])).toBe("text");
    expect(guessType([])).toBe("text");
  });
});
