import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { buildOpeningLine, hasDisclosure } from "@/lib/opening-line";
import { AGENT_OUTCOMES } from "@/lib/outcomes";
import { DEFAULT_SETTINGS } from "@/lib/settings";

// The app and the voice agent are two programs that must agree on a few
// things. Each keeps its own copy; these tests fail when the copies drift.

const require = createRequire(import.meta.url);
const agentOutcomes = require("../../agent/src/outcomes.js") as { AGENT_OUTCOMES: string[] };
const agentOpening = require("../../agent/src/opening.js") as {
  hasDisclosure: (line: string, repFirstName: string) => boolean;
  resolveOpeningLine: (meta: Record<string, unknown>) => string;
};

describe("the app and the agent agree", () => {
  it("on how a call can be filed", () => {
    expect(agentOutcomes.AGENT_OUTCOMES).toEqual([...AGENT_OUTCOMES]);
  });

  it("on what counts as saying you are an AI", () => {
    const lines = [
      buildOpeningLine(DEFAULT_SETTINGS),
      "Hi, I'd like to make a large booking. Is the owner around?",
      "Hi, this is Sara calling for Adil.",
      "Hi, this is an AI assistant.",
      "",
    ];
    for (const line of lines) expect(agentOpening.hasDisclosure(line, "Adil")).toBe(hasDisclosure(line, "Adil"));
  });

  it("the agent speaks the app's opening line as written", () => {
    const line = buildOpeningLine(DEFAULT_SETTINGS);
    expect(agentOpening.resolveOpeningLine({ ...DEFAULT_SETTINGS, openingLine: line })).toBe(line);
  });
});
