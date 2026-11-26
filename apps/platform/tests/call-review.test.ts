import { describe, expect, it } from "vitest";
import { activeLineAt, callerMoodLines, clock, flowPath, hasTimeline, moodLevel, moodStats, sampleWaveform } from "@outreach/core/call-review";
import { seedState } from "@/lib/seed";
import { TEMPLATES, flowFromTemplate } from "@outreach/core/templates";
import type { TranscriptLine } from "@outreach/core/types";

const lines: TranscriptLine[] = [
  { who: "agent", text: "Hi", at: 0 },
  { who: "caller", text: "Hello", at: 4.2 },
  { who: "action", text: "Booked" },
  { who: "agent", text: "Done", at: 9 },
];

describe("following the recording", () => {
  it("lights the last line that has started, and holds it through a pause", () => {
    expect(activeLineAt(lines, -1)).toBe(-1);
    expect(activeLineAt(lines, 0)).toBe(0);
    expect(activeLineAt(lines, 6)).toBe(1); // between lines: the caller is still lit
    expect(activeLineAt(lines, 30)).toBe(3);
  });

  it("knows when a transcript can follow audio", () => {
    expect(hasTimeline(lines)).toBe(true);
    expect(hasTimeline([{ who: "agent", text: "x" }])).toBe(false);
  });

  it("formats a clock", () => {
    expect(clock(0)).toBe("0:00");
    expect(clock(65.9)).toBe("1:05");
    expect(clock(-3)).toBe("0:00");
  });
});

describe("caller mood", () => {
  it("sums up a call and pairs each score with what the caller said", () => {
    expect(moodStats([0.1, 0.5, 0.2])).toEqual({ peak: 0.5, mean: expect.closeTo(0.2667, 3), turns: 3, level: "uneasy" });
    expect(moodStats([])).toBeNull();
    expect(callerMoodLines(lines, [0.3])).toEqual([{ text: "Hello", score: 0.3 }]);
  });

  it("uses three plain levels", () => {
    expect([0.1, 0.45, 0.8].map(moodLevel)).toEqual(["calm", "uneasy", "upset"]);
  });
});

describe("the path through the flow", () => {
  const service = flowFromTemplate(TEMPLATES.find((t) => t.id === "service_check") ?? null).steps;

  it("follows the saved answers to the ending the call reached", () => {
    const path = flowPath(service, { all_good: "yes", wants_service: "yes" });
    expect(path.outcome).toBe("service_booked");
    expect(path.stoppedAt).toBeNull();
    expect(path.steps.some((s) => s.kind === "action" && s.action === "book")).toBe(true);
  });

  it("stops at the first question the call never got an answer to", () => {
    const path = flowPath(service, { all_good: "no" });
    expect(path.stoppedAt).toMatchObject({ kind: "ask", field: "problem" });
    expect(path.outcome).toBeNull();
  });
});

describe("sample data and waveforms", () => {
  it("draws the same waveform for the same call", () => {
    const a = sampleWaveform("call_1", 80);
    expect(a).toEqual(sampleWaveform("call_1", 80));
    expect(a).toHaveLength(80);
    expect(Math.min(...a)).toBeGreaterThan(0);
    expect(Math.max(...a)).toBeLessThanOrEqual(1);
  });

  it("every sample recording has a timeline that fits inside it, and mood for each caller line", () => {
    for (const call of seedState(new Date("2026-11-26T12:00:00")).calls.filter((c) => c.recording)) {
      const timed = call.transcript.filter((l) => l.at !== undefined).map((l) => l.at as number);
      expect(timed.length, call.id).toBeGreaterThan(0);
      expect(Math.max(...timed), call.id).toBeLessThan(call.recording!.durationSec);
      expect([...timed].sort((a, b) => a - b), call.id).toEqual(timed);
      if (call.mood) expect(call.mood.length, call.id).toBe(call.transcript.filter((l) => l.who === "caller").length);
    }
  });
});
