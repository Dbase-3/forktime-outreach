// What an agent hands over at the end of a call: one structured record. Each
// Ask step's answer, plus the extra fields it listens for, each with a type;
// required fields can come back missing (and are flagged), the rest fall back
// to their default. Pure.

import { allSteps } from "./flow-tree";
import type { AnswerType, DataField, FieldType, Flow } from "./types";

export interface SchemaField {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  fallback?: string;
  description: string;
  from: "step" | "listen"; // asked by a step, or picked up from the conversation
  stepId?: string;
}

const ANSWER_TO_FIELD: Record<AnswerType, FieldType> = { text: "text", yesno: "yesno", number: "number", date: "date", choice: "choice" };

/** Every field the agent collects, Ask steps first (in the order they appear), each key once. */
export function dataSchema(flow: Pick<Flow, "steps" | "dataFields" | "askRequired">): SchemaField[] {
  const seen = new Set<string>();
  const fromSteps: SchemaField[] = [];
  for (const step of allSteps(flow.steps)) {
    if (step.kind !== "ask" || !step.field || seen.has(step.field)) continue;
    seen.add(step.field);
    fromSteps.push({
      key: step.field,
      label: step.field.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()),
      type: ANSWER_TO_FIELD[step.answerType],
      required: flow.askRequired[step.field] ?? true,
      description: step.question,
      from: "step",
      stepId: step.id,
    });
  }
  const extra = flow.dataFields.filter((f) => f.key && !seen.has(f.key)).map((f: DataField) => ({ ...f, from: "listen" as const }));
  return [...fromSteps, ...extra];
}

export interface StructuredResult {
  data: Record<string, string | null>;
  missingRequired: string[]; // labels
  usedFallback: string[]; // keys filled from their fallback
}

/** The record a call produces from what it saved: fallbacks for optional fields, nulls (flagged) for required ones. */
export function structuredResult(schema: SchemaField[], saved: Record<string, string>): StructuredResult {
  const data: Record<string, string | null> = {};
  const missingRequired: string[] = [];
  const usedFallback: string[] = [];
  for (const field of schema) {
    const value = (saved[field.key] ?? "").trim();
    if (value) {
      data[field.key] = value;
      continue;
    }
    if (field.required) {
      data[field.key] = null;
      missingRequired.push(field.label);
      continue;
    }
    data[field.key] = field.fallback?.trim() ? field.fallback.trim() : null;
    if (field.fallback?.trim()) usedFallback.push(field.key);
  }
  return { data, missingRequired, usedFallback };
}
