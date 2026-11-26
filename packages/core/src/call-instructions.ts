// What the voice model is told on a real call, built from the agent the owner
// made: who it is (their prompt), how to talk on a phone, the facts of this
// call, the workflow protocol and where the call is now, and the knowledge it
// answers from. Pure, so the API, the agent and tests build the same text.

import { readAnswer } from "./spoken";
import { fill } from "./variables";
import { outcomesOf } from "./flow-tree";
import { describePosition, type Position } from "./workflow-run";
import type { SchemaField } from "./agent-data";
import type { Flow } from "./types";

/** Endings any call can reach besides the workflow's own (the model picks one with end_call). */
export const STANDARD_OUTCOMES = ["not_interested", "call_back_later", "do_not_call", "wrong_number", "voicemail", "other"] as const;

/** Knowledge up to this size goes in the instructions; above it, the agent searches. */
export const INLINE_KNOWLEDGE_CHARS = 8000;

export interface CallSetup {
  flow: Pick<Flow, "name" | "agent" | "prompt" | "greeting" | "steps" | "timezone">;
  business: string;
  direction: "inbound" | "outbound";
  /** Variables for this call: agent, business, today, first_name, name, phone, the contact's fields. */
  values: Record<string, string>;
  schema: SchemaField[];
  knowledge: { inline: { name: string; text: string }[]; searchable: boolean };
  test: boolean;
}

export function callOutcomes(flow: Pick<Flow, "steps">): string[] {
  return [...new Set([...outcomesOf(flow), ...STANDARD_OUTCOMES])];
}

const PERSONALITY: Record<Flow["agent"]["personality"], string> = {
  friendly: "warm and casual, putting people at ease",
  professional: "polite and to the point",
  upbeat: "energetic and positive",
  calm: "slow, patient and reassuring",
};

export function callInstructions(setup: CallSetup, position: Position): string {
  const { flow, values, schema } = setup;
  const persona = fill(flow.prompt, values).trim();
  const facts = Object.entries(values)
    .filter(([k, v]) => v && !["agent", "business"].includes(k))
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");
  const listen = schema.filter((f) => f.from === "listen");
  const knowledge = setup.knowledge.inline.length
    ? setup.knowledge.inline.map((d) => `<document name="${d.name}">\n${d.text}\n</document>`).join("\n")
    : "";

  return [
    persona,
    `# On the phone
You are speaking on a live phone call as ${values.agent}, the AI assistant for ${setup.business}. Be ${PERSONALITY[flow.agent.personality]}. Speak ${flow.agent.language}.
- Keep each reply to one or two short sentences, then let them talk. One question at a time.
- Plain spoken words only: no lists, no symbols, no markdown. Say times and prices the way people say them.
- If they ask, you are an AI assistant, and the call is recorded. Never claim to be a person.
- Never make up facts, prices or availability. If you don't know, say the team will follow up.`,
    `# This call
- ${setup.direction === "inbound" ? "They called you." : "You called them."}
- Business: ${setup.business}
${facts}${setup.test ? "\n- This is a test call by the business owner. Act exactly as on a real call." : ""}`,
    `# The workflow
The call follows a workflow that the system runs. You never pick the next step yourself.
- When they answer the current question, call note with the field and their answer first, before you say anything. Never ask a follow-up question of your own: the result tells you what to say next. Say it in your own natural words, keeping its meaning.
- If they answer a question that comes later, note that too, so it isn't asked again.
- If they change an earlier answer, note the new answer.
- If they ask something else, answer briefly, then come back to the current step.
- When the workflow ends, the system says the closing line and hangs up for you.
- Call end_call yourself only when the call can't go on: they want to stop, have no time, ask not to be called again, it's a wrong number, or it's voicemail.${
      listen.length
        ? `\n- Also listen for these, and note them whenever they come up:\n${listen.map((f) => `  - ${f.key}: ${f.description || f.label}`).join("\n")}`
        : ""
    }

Right now: ${describePosition(position)}`,
    knowledge ? `# What you know\nAnswer questions from these documents only.\n${knowledge}` : setup.knowledge.searchable ? "# What you know\nFor questions about the business, call search_knowledge first and answer from what it returns." : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** A noted answer, checked and put in the field's format. Unclear answers come back with a reason for the model. */
export function noteValue(field: Pick<SchemaField, "type" | "label"> & { choices?: string[] }, said: string): { ok: true; value: string } | { ok: false; reason: string } {
  const raw = String(said ?? "").trim().slice(0, 500);
  if (!raw) return { ok: false, reason: "The answer is empty. Ask again." };
  if (field.type === "yesno") {
    const v = readAnswer({ answerType: "yesno" }, raw);
    return v === "Yes" || v === "No" ? { ok: true, value: v } : { ok: false, reason: `"${field.label}" needs Yes or No. Ask them to confirm.` };
  }
  if (field.type === "choice" && field.choices?.length) {
    const v = readAnswer({ answerType: "choice", choices: field.choices }, raw);
    return field.choices.includes(v) ? { ok: true, value: v } : { ok: false, reason: `"${field.label}" must be one of: ${field.choices.join(", ")}. Ask which one.` };
  }
  if (field.type === "number") {
    const v = readAnswer({ answerType: "number" }, raw.replace(/,/g, ""));
    return /^-?\d+(\.\d+)?$/.test(v) ? { ok: true, value: v } : { ok: false, reason: `"${field.label}" needs a number. Ask for it.` };
  }
  if (field.type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return { ok: false, reason: `Save "${field.label}" as a date in YYYY-MM-DD (work it out from what they said and today's date).` };
  return { ok: true, value: raw };
}
