// Text must stay readable in both themes. Reads the real tokens from
// app/globals.css and checks every text level against every background.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(path.join(__dirname, "../app/globals.css"), "utf8");

function block(selector: string): Record<string, number[]> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`${selector} not found in globals.css`);
  const body = css.slice(start, css.indexOf("}", start));
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(\d+) (\d+) (\d+);/g)].map(([, k, r, g, b]) => [k, [+r, +g, +b]]));
}

/** A theme's tokens. "Change with AI" is the dark set with its own surfaces on top. */
function tokens(selector: ":root" | ".dark" | ".ai-dock.dark"): Record<string, number[]> {
  return selector === ".ai-dock.dark" ? { ...block(".dark"), ...block(".ai-dock.dark") } : block(selector);
}

function luminance([r, g, b]: number[]): number {
  const f = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(a: number[], b: number[]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const BACKGROUNDS = ["background", "surface", "subtle", "muted"];
const FLOORS: Record<string, number> = { fg: 12, "fg-2": 11, "fg-3": 7, "fg-4": 4.5, accent: 4.5 };

describe.each([":root", ".dark", ".ai-dock.dark"] as const)("text contrast in %s", (selector) => {
  const t = tokens(selector);

  it.each(Object.entries(FLOORS))("%s clears %s:1 on every background", (text, floor) => {
    for (const bg of BACKGROUNDS) {
      expect(contrast(t[text], t[bg]), `${text} on ${bg}`).toBeGreaterThanOrEqual(floor);
    }
  });

  it("keeps the four text levels visibly apart", () => {
    const onSurface = ["fg", "fg-2", "fg-3", "fg-4"].map((k) => contrast(t[k], t.surface));
    for (let i = 1; i < onSurface.length; i++) expect(onSurface[i - 1] / onSurface[i]).toBeGreaterThan(1.3);
  });
});
