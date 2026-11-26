import { describe, expect, it } from "vitest";
import { insertVar, unknownVars, variableGroups, varsIn } from "@/lib/variables";

const fields = [
  { key: "first_name", label: "First name" },
  { key: "car_model", label: "Car model" },
];

describe("variables a line can use", () => {
  it("lists the call's own, the contact's fields and earlier answers, once each", () => {
    const groups = variableGroups(fields, [{ key: "wants_service", label: "Wants service" }]);
    expect(groups.map((g) => g.title)).toEqual(["This call", "Contact", "Answers on this call"]);
    const contact = groups[1].vars.map((v) => v.key);
    expect(contact.filter((k) => k === "first_name")).toHaveLength(1);
    expect(contact).toContain("car_model");
    expect(groups[2].vars[0].key).toBe("wants_service");
  });

  it("finds the ones used and the ones nothing fills in", () => {
    const groups = variableGroups(fields);
    const text = "Hi {first_name}, it's {agent}. How's the {car_modle}? {first_name}";
    expect(varsIn(text)).toEqual(["first_name", "agent", "car_modle"]);
    expect(unknownVars(text, groups)).toEqual(["car_modle"]);
  });

  it("inserts at the cursor with a space when needed", () => {
    expect(insertVar("Hi", 2, 2, "first_name")).toEqual({ text: "Hi {first_name}", caret: 15 });
    expect(insertVar("Hi , welcome", 3, 3, "first_name")).toEqual({ text: "Hi {first_name}, welcome", caret: 15 });
    expect(insertVar("Hi NAME!", 3, 7, "first_name").text).toBe("Hi {first_name}!");
  });
});

describe("filling variables (B30)", () => {
  it("uses the value, then the fallback, else leaves the variable out tidily", async () => {
    const { fill } = await import("@/lib/variables");
    expect(fill("Hi {first_name}, this is {agent}.", { first_name: "Mia", agent: "Ava" })).toBe("Hi Mia, this is Ava.");
    expect(fill("Hi {first_name|there}, this is {agent}.", { agent: "Ava" })).toBe("Hi there, this is Ava.");
    expect(fill("Hi {first_name}, this is {agent}.", { agent: "Ava" })).toBe("Hi, this is Ava.");
    expect(fill("{first_name} thanks for calling.", {})).toBe("thanks for calling.");
    expect(fill("How is the {car_model} going?", {})).toBe("How is the going?");
    expect(fill("Hello, {name}, welcome...", {})).toBe("Hello, welcome...");
    expect(fill("Wait... what? {x}", {})).toBe("Wait... what?");
  });

  it("reads a fallback as part of the variable, not a new one", async () => {
    const { varsIn } = await import("@/lib/variables");
    expect(varsIn("Hi {first_name|there} and {agent}")).toEqual(["first_name", "agent"]);
  });
});
