import { describe, expect, it } from "vitest";
import { audienceSize, conditionHolds, describeCondition, describeTrigger, dueDateFor, upcomingCalls } from "@/lib/automation";
import type { Automation, Contact, FieldDef } from "@/lib/types";

const defs: FieldDef[] = [{ key: "purchase_date", label: "Purchase date", type: "date" }, { key: "car_model", label: "Car model", type: "text" }];

const contact = (id: string, fields: Record<string, string>): Contact => ({ id, name: id, phone: "+1555000000", groups: [], fields, createdAt: "2026-01-01" });

const serviceCheck = (over: Partial<Automation> = {}): Automation => ({
  id: "a1",
  name: "Service check",
  enabled: true,
  trigger: { kind: "date_field", field: "purchase_date", offsetDays: 30, when: "after" },
  conditions: [],
  flowId: "f1",
  followUps: [{ outcome: "not_now", thenDays: 90 }],
  maxCallsPerWeek: 1,
  updatedAt: "2026-11-26",
  ...over,
});

describe("conditionHolds", () => {
  const values = { model: "Corolla", km: "12000", happy: "Yes", empty: "" };
  it.each([
    [{ field: "model", op: "is", value: "corolla" }, true],
    [{ field: "model", op: "is_not", value: "Camry" }, true],
    [{ field: "model", op: "contains", value: "roll" }, true],
    [{ field: "km", op: "more_than", value: "10000" }, true],
    [{ field: "km", op: "less_than", value: "10000" }, false],
    [{ field: "model", op: "more_than", value: "5" }, false],
    [{ field: "happy", op: "is_yes" }, true],
    [{ field: "happy", op: "is_no" }, false],
    [{ field: "empty", op: "is_empty" }, true],
    [{ field: "missing", op: "is_set" }, false],
  ] as const)("%j → %s", (condition, expected) => {
    expect(conditionHolds(condition, values)).toBe(expected);
  });
});

describe("describing", () => {
  it("reads a date trigger in months when it can", () => {
    expect(describeTrigger(serviceCheck().trigger, defs, [])).toBe("1 month after purchase date");
    expect(describeTrigger({ kind: "date_field", field: "purchase_date", offsetDays: 3, when: "before" }, defs, [])).toBe("3 days before purchase date");
  });

  it("reads a call-outcome trigger with the flow's name", () => {
    const flows = [{ id: "f1", name: "Service check" }] as never;
    expect(describeTrigger({ kind: "call_outcome", flowId: "f1", outcome: "not_now" }, defs, flows)).toBe('When "Service check" ends with not now');
  });

  it("reads a condition", () => {
    expect(describeCondition({ field: "car_model", op: "is", value: "Corolla" }, defs)).toBe('Car model is "Corolla"');
    expect(describeCondition({ field: "car_model", op: "is_set" }, defs)).toBe("Car model has a value");
  });
});

describe("who gets called", () => {
  const now = new Date("2026-11-26T10:00:00");
  const contacts = [
    contact("due-soon", { purchase_date: "2026-11-01", car_model: "Corolla" }), // due 12-01
    contact("due-later", { purchase_date: "2026-12-20", car_model: "Camry" }), // due 01-19
    contact("already-past", { purchase_date: "2026-09-01" }), // due 10-01
    contact("no-date", { car_model: "Corolla" }),
  ];

  it("works out the due date from the contact's field", () => {
    expect(dueDateFor(serviceCheck().trigger, contacts[0])?.toDateString()).toBe(new Date("2026-12-01T00:00:00").toDateString());
    expect(dueDateFor(serviceCheck().trigger, contacts[3])).toBeNull();
  });

  it("lists upcoming calls soonest first, skipping past and undated ones", () => {
    expect(upcomingCalls(serviceCheck(), contacts, now).map((p) => p.contact.id)).toEqual(["due-soon", "due-later"]);
  });

  it("respects the horizon and the conditions", () => {
    expect(upcomingCalls(serviceCheck(), contacts, now, 10).map((p) => p.contact.id)).toEqual(["due-soon"]);
    const corollaOnly = serviceCheck({ conditions: [{ field: "car_model", op: "is", value: "Corolla" }] });
    expect(upcomingCalls(corollaOnly, contacts, now).map((p) => p.contact.id)).toEqual(["due-soon"]);
    expect(audienceSize(corollaOnly, contacts)).toBe(2);
  });

  it("plans nothing for event triggers", () => {
    expect(upcomingCalls(serviceCheck({ trigger: { kind: "new_contact" } }), contacts, now)).toEqual([]);
  });
});
