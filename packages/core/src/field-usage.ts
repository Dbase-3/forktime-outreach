// Where a contact field is used (audit B23): deleting or retyping a field used
// to leave campaign rules, triggers, saved answers and agent decisions pointing
// at it, still running. Pure.

import { allSteps } from "./flow-tree";
import { varsIn } from "./variables";
import type { AppState } from "./types";

export function fieldUsage(state: Pick<AppState, "campaigns" | "flows">, key: string): string[] {
  const uses: string[] = [];
  for (const c of state.campaigns) {
    if (c.audience.filter.rules.some((r) => r.field === key)) uses.push(`Campaign “${c.name}”: who to call`);
    if ((c.trigger.kind === "date_field" || c.trigger.kind === "field_change") && c.trigger.field === key) uses.push(`Campaign “${c.name}”: when to call`);
    if (c.writeBacks.some((w) => w.to === key)) uses.push(`Campaign “${c.name}”: saves answers to it`);
  }
  for (const f of state.flows) {
    const steps = allSteps(f.steps);
    const asked = new Set(steps.flatMap((s) => (s.kind === "ask" ? [s.field] : [])));
    if (!asked.has(key) && steps.some((s) => s.kind === "branch" && s.condition.field === key)) uses.push(`Agent “${f.name}”: a decision`);
    const texts = [f.greeting, f.prompt, ...steps.flatMap((s) => (s.kind === "say" || s.kind === "end" ? [s.text] : s.kind === "ask" ? [s.question] : []))];
    if (texts.some((t) => varsIn(t).includes(key))) uses.push(`Agent “${f.name}”: {${key}} in what it says`);
  }
  return uses;
}
