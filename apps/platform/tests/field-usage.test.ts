import { describe, expect, it } from "vitest";
import { fieldUsage } from "@/lib/field-usage";
import { countryOfZone, dncSet, toE164 } from "@/lib/phone";
import { seedState } from "@/lib/seed";

describe("where a field is used (B23)", () => {
  it("finds campaign rules, triggers, saved answers and agent lines", () => {
    const s = seedState(new Date(2026, 10, 26));
    expect(fieldUsage(s, "purchase_date").some((u) => /when to call/.test(u))).toBe(true);
    expect(fieldUsage(s, "car_model").some((u) => /in what it says/.test(u))).toBe(true);
    expect(fieldUsage(s, "suburb")).toEqual([]);
  });
});

describe("phone numbers", () => {
  it("reads local and international forms into E.164, in the workspace's country", () => {
    expect(toE164("0412 555 019", "AU")).toBe("+61412555019");
    expect(toE164("+61 412 555 019", "US")).toBe("+61412555019");
    expect(toE164("(415) 555-2671", "US")).toBe("+14155552671");
    expect(toE164("12", "AU")).toBeNull();
    expect(toE164("", "AU")).toBeNull();
  });

  it("matches the do-not-call list whichever way it was written", () => {
    expect(dncSet(["0412 555 019", "nonsense"], "AU")).toEqual(new Set(["+61412555019"]));
  });

  it("guesses the country from the time zone", () => {
    expect(countryOfZone("Australia/Perth")).toBe("AU");
    expect(countryOfZone("America/Los_Angeles")).toBe("US");
    expect(countryOfZone("America/Toronto")).toBe("CA");
  });
});
