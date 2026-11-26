import { describe, expect, it } from "vitest";
import { chunkText } from "../src/chunks";

describe("chunkText", () => {
  it("keeps a short document whole", () => {
    expect(chunkText("Open 9 to 5, Monday to Friday.")).toEqual([{ index: 0, heading: "", text: "Open 9 to 5, Monday to Friday." }]);
  });

  it("cuts at headings and carries the heading on each passage", () => {
    const text = "## Hours\nhttps://x.test/hours\n\nOpen 9 to 5.\n\n## Loan cars\n\nBook a day ahead.";
    const chunks = chunkText(text);
    expect(chunks.map((c) => [c.heading, c.text])).toEqual([
      ["Hours", "https://x.test/hours\n\nOpen 9 to 5."],
      ["Loan cars", "Book a day ahead."],
    ]);
  });

  it("keeps passages near the target size, splits a huge paragraph at sentences, and overlaps by a sentence", () => {
    const para = (n: number) => Array.from({ length: 8 }, (_, i) => `Sentence ${n}.${i} says something useful about servicing.`).join(" ");
    const text = Array.from({ length: 12 }, (_, i) => para(i)).join("\n\n");
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.every((c) => c.text.length <= 1800 + 300)).toBe(true);
    for (let i = 1; i < chunks.length; i++) {
      const lastOfPrev = chunks[i - 1].text.split(/(?<=\.)\s+/).pop()!;
      expect(chunks[i].text.startsWith(lastOfPrev)).toBe(true);
    }
    const one = chunkText(Array.from({ length: 200 }, (_, i) => `Fact ${i} is here.`).join(" "));
    expect(one.length).toBeGreaterThan(1);
    // Nothing is lost.
    for (let i = 0; i < 200; i++) expect(one.some((c) => c.text.includes(`Fact ${i} is here.`))).toBe(true);
  });
});
