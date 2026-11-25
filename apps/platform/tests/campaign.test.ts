import { describe, expect, it } from "vitest";
import { audienceOf, campaignIssues, campaignSummary, daysWords, defaultCampaign, describeTrigger, dueDate, upcomingCalls } from "@/lib/campaign";
import { daysLabel } from "@/lib/automation";
import type { Campaign, Contact, FieldDef } from "@/lib/types";

const now = new Date("2026-11-26T12:00:00");
const defs: FieldDef[] = [{ key: "purchase_date", label: "Purchase date", type: "date" }, { key: "tier", label: "Tier", type: "choice" }];
const contact = (id: string, fields: Record<string, string>, groups = ["Buyers"]): Contact => ({ id, name: `P${id}`, phone: "+61400000000", groups, fields, createdAt: "" });
const people = [
  contact("1", { purchase_date: "2026-11-01", tier: "Gold" }), // due 12-01 at +30
  contact("2", { purchase_date: "2026-12-20", tier: "Standard" }), // due 01-19
  contact("3", { purchase_date: "2026-09-01", tier: "Gold" }), // past
  contact("4", { tier: "Gold" }, ["Web"]),
];
const campaign = (over: Partial<Campaign> = {}): Campaign => ({ ...defaultCampaign("f1", now), ...over });

describe("audience", () => {
  it("is the list, then the conditions", () => {
    expect(audienceOf(campaign(), people, now).map((c) => c.id)).toEqual(["1", "2", "3", "4"]);
    expect(audienceOf(campaign({ audience: { list: "Buyers", filter: { match: "all", rules: [] } } }), people, now).map((c) => c.id)).toEqual(["1", "2", "3"]);
    expect(audienceOf(campaign({ audience: { list: "Buyers", filter: { match: "all", rules: [{ field: "tier", op: "any_of", value: "Gold" }] } } }), people, now).map((c) => c.id)).toEqual(["1", "3"]);
  });
});

describe("triggers and timing", () => {
  const dateTrigger = { kind: "date_field" as const, field: "purchase_date", offsetDays: 30, when: "after" as const };

  it("says the trigger in plain words", () => {
    expect(describeTrigger(dateTrigger, defs)).toBe("1 month after their purchase date");
    expect(describeTrigger({ ...dateTrigger, when: "before", offsetDays: 3 }, defs)).toBe("3 days before their purchase date");
    expect(describeTrigger({ kind: "added" }, defs)).toBe("As soon as someone joins the audience");
    expect(describeTrigger({ kind: "field_change", field: "tier", becomes: "Gold" }, defs)).toBe('When tier becomes "Gold"');
  });

  it("works out due dates and lists who's next, soonest first, only for always-on campaigns", () => {
    expect(dueDate(dateTrigger, people[0])?.toDateString()).toBe(new Date("2026-12-01T00:00:00").toDateString());
    expect(dueDate(dateTrigger, people[3])).toBeNull();
    const c = campaign({ mode: "always", trigger: dateTrigger, audience: { list: "Buyers", filter: { match: "all", rules: [] } } });
    expect(upcomingCalls(c, people, now).map((p) => p.contact.id)).toEqual(["1", "2"]);
    expect(upcomingCalls({ ...c, mode: "once" }, people, now)).toEqual([]);
  });

  it("says the days briefly", () => {
    expect(daysWords([1, 2, 3, 4, 5])).toBe("Weekdays");
    expect(daysWords([0, 1, 2, 3, 4, 5, 6])).toBe("Every day");
    expect(daysWords([5, 1, 3])).toBe("Mon, Wed, Fri");
    expect(daysWords([1, 2, 3, 4, 5, 6])).toBe("Mon to Sat");
    expect([3, 7, 14, 30, 90].map(daysLabel)).toEqual(["3 days", "1 week", "2 weeks", "1 month", "3 months"]);
  });
});

describe("summary and checks", () => {
  const flows = [{ id: "f1", name: "Service check-in", status: "live" as const }];

  it("sums a campaign up in a few lines", () => {
    const c = campaign({
      mode: "always",
      trigger: { kind: "date_field", field: "purchase_date", offsetDays: 30, when: "after" },
      audience: { list: "Buyers", filter: { match: "all", rules: [{ field: "tier", op: "any_of", value: "Gold" }] } },
      followUps: [{ id: "x", outcome: "not_now", action: "call", afterDays: 90 }],
    });
    expect(campaignSummary(c, flows, defs, 2)).toEqual([
      "Service check-in calls the Buyers list where tier is any of gold (2 people now).",
      "1 month after their purchase date.",
      "Weekdays, 9 am to 6 pm in each person's time zone. No answer: 1 more try, 4 h apart.",
      "If it ends not now, call again after 3 months.",
    ]);
  });

  it("won't start without a live agent, days and sensible hours", () => {
    expect(campaignIssues(campaign(), flows)).toEqual([]);
    expect(campaignIssues(campaign({ agentId: "nope" }), flows)).toEqual(["Pick an agent."]);
    expect(campaignIssues(campaign(), [{ id: "f1", status: "draft" }])).toEqual(["The agent is a draft. Put it live first."]);
    expect(campaignIssues(campaign({ days: [], startHour: 18, endHour: 9 }), flows)).toEqual(["Pick at least one day to call.", "Calling hours end before they start."]);
    expect(campaignIssues(campaign({ voicemail: "leave_message" }), flows)).toEqual(["Write the voicemail message."]);
  });
});
