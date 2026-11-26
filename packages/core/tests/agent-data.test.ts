import { describe, expect, it } from "vitest";
import { dataSchema, structuredResult } from "../src/agent-data";
import { TEMPLATES, flowFromTemplate } from "../src/templates";

const service = () => flowFromTemplate(TEMPLATES.find((t) => t.id === "service_check") ?? null);

describe("what an agent collects", () => {
  it("takes each Ask step's field once, in order, with its answer type, required by default", () => {
    const schema = dataSchema(service());
    expect(schema.map((f) => [f.key, f.type, f.required, f.from])).toEqual([
      ["all_good", "yesno", true, "step"],
      ["problem", "text", true, "step"],
      ["wants_service", "yesno", true, "step"],
    ]);
  });

  it("adds the fields it listens for, and lets an Ask field be not required", () => {
    const flow = {
      ...service(),
      askRequired: { problem: false },
      dataFields: [
        { key: "callback_time", label: "Call back at", type: "text" as const, description: "When they'd like a call back", required: false, fallback: "Anytime" },
        { key: "all_good", label: "Dup", type: "text" as const, description: "", required: false },
      ],
    };
    const schema = dataSchema(flow);
    expect(schema.map((f) => f.key)).toEqual(["all_good", "problem", "wants_service", "callback_time"]);
    expect(schema.find((f) => f.key === "problem")?.required).toBe(false);
  });
});

describe("the record a call produces", () => {
  const schema = dataSchema({
    ...service(),
    askRequired: { problem: false },
    dataFields: [{ key: "callback_time", label: "Call back at", type: "text", description: "", required: false, fallback: "Anytime" }],
  });

  it("keeps what was said, falls back where allowed, and flags missing required fields", () => {
    expect(structuredResult(schema, { all_good: "yes", wants_service: " " })).toEqual({
      data: { all_good: "yes", problem: null, wants_service: null, callback_time: "Anytime" },
      missingRequired: ["Wants service"],
      usedFallback: ["callback_time"],
    });
  });

  it("is complete when every required field came back", () => {
    expect(structuredResult(schema, { all_good: "no", wants_service: "yes", callback_time: "after 5" }).missingRequired).toEqual([]);
  });
});
