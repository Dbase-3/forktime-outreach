import { describe, expect, it } from "vitest";
import { audienceBreakdown, audienceOf, callRulesFor, campaignIssues, campaignSummary, daysWords, defaultCampaign, describeTrigger, dueDate, upcomingCalls } from "../src/campaign";
import { TEMPLATES, flowFromTemplate } from "../src/templates";
import { daysLabel } from "../src/automation";
import type { Campaign, Contact, FieldDef } from "../src/types";

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

const allDefs: FieldDef[] = [...defs, { key: "first_name", label: "First name", type: "text" }, { key: "car_model", label: "Car model", type: "text" }];
const liveAgent = () => ({ ...flowFromTemplate(TEMPLATES.find((t) => t.id === "service_check") ?? null, now, "Australia/Sydney"), id: "f1", name: "Service check-in", status: "live" as const, numberId: "n1" });

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
    const ctx = (over: Partial<Parameters<typeof campaignIssues>[1]> = {}) => ({ flows: [liveAgent()], defs: allDefs, audienceCount: 3, now, ...over });
    expect(campaignIssues(campaign(), ctx())).toEqual([]);
    expect(campaignIssues(campaign({ agentId: "nope" }), ctx())[0]).toMatch(/deleted/);
    expect(campaignIssues(campaign(), ctx({ flows: [{ ...liveAgent(), status: "draft" }] }))[0]).toMatch(/draft/);
    expect(campaignIssues(campaign({ days: [], startHour: 18, endHour: 9 }), ctx())).toEqual(["Pick at least one day to call.", "Calling hours end before they start."]);
    expect(campaignIssues(campaign({ voicemail: "leave_message" }), ctx())).toEqual(["Write the voicemail message."]);
  });
});

describe("audience skips who can't be called (B25, B34)", () => {
  it("drops the do-not-call list (however the number was written) and numbers that can't be dialled", () => {
    const list = [
      { ...contact("a", {}), phone: "0412 555 019" },
      { ...contact("b", {}), phone: "+61 412 555 020" },
      { ...contact("c", {}), phone: "" },
      { ...contact("d", {}), phone: "12" },
    ];
    const rules = callRulesFor({ timezone: "Australia/Sydney", doNotCall: ["+61412555019"] });
    const out = audienceBreakdown(campaign(), list, now, rules);
    expect(out.included.map((c) => c.id)).toEqual(["b"]);
    expect(out.skipped).toEqual({ doNotCall: 1, badPhone: 2 });
    expect(audienceOf(campaign(), list, now, rules).map((c) => c.id)).toEqual(["b"]);
  });
});

describe("date triggers across daylight saving (B4)", () => {
  it("counts calendar days, so the call lands on the right day", () => {
    const due = dueDate({ kind: "date_field", field: "d", offsetDays: 7, when: "before" }, contact("x", { d: "2026-10-10" }));
    expect([due?.getFullYear(), due?.getMonth(), due?.getDate(), due?.getHours()]).toEqual([2026, 9, 3, 0]);
  });
});

describe("start checks (audit)", () => {
  const ctx = (over: Partial<Parameters<typeof campaignIssues>[1]> = {}) => ({ flows: [liveAgent()], defs: allDefs, audienceCount: 3, now, ...over });

  it("needs an agent that can make calls from a number", () => {
    expect(campaignIssues(campaign(), ctx({ flows: [{ ...liveAgent(), numberId: undefined }] }))[0]).toMatch(/no phone number/);
    expect(campaignIssues(campaign(), ctx({ flows: [{ ...liveAgent(), direction: "inbound" }] }))[0]).toMatch(/only answers/);
    expect(campaignIssues(campaign(), ctx({ flows: [{ ...liveAgent(), greeting: "Hi there" }] }))[0]).toMatch(/problems to fix/);
  });

  it("needs someone to call, a start time ahead, and hours inside the workspace's", () => {
    expect(campaignIssues(campaign(), ctx({ audienceCount: 0 }))).toContain("Nobody in the audience can be called yet.");
    expect(campaignIssues(campaign({ startAt: "2026-11-01T09:00" }), ctx()).some((i) => /start time has passed/.test(i))).toBe(true);
    const ws = { callingDays: [1, 2, 3, 4, 5], callingStart: 10, callingEnd: 17 };
    expect(campaignIssues(campaign(), ctx({ workspace: ws })).some((i) => /outside your workspace/.test(i))).toBe(true);
  });

  it("catches follow-ups and saved answers that no longer fit the agent (B22)", () => {
    const issues = campaignIssues(
      campaign({
        followUps: [{ id: "x", outcome: "gone_outcome", action: "text", afterDays: 1 }],
        writeBacks: [{ from: "removed_answer", to: "car_model" }],
        webhook: "not a url",
      }),
      ctx(),
    );
    expect(issues.some((i) => /never ends that way/.test(i))).toBe(true);
    expect(issues).toContain("Write the follow-up text.");
    expect(issues.some((i) => /isn't collected/.test(i))).toBe(true);
    expect(issues).toContain("The webhook needs a full https:// address.");
  });
});
