// What the voice model is told on a real call, built from the agent the owner
// made: who it is (their prompt), how to talk on a phone, the facts of this
// call, the workflow protocol and where the call is now, and the knowledge it
// answers from. Pure, so the API, the agent and tests build the same text.

import { isLiveBooking } from "./calendar";
import { readAnswer } from "./spoken";
import { fill } from "./variables";
import { outcomesOf } from "./flow-tree";
import { describePosition, type Ahead, type Position } from "./workflow-run";
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
  /** A connected calendar the agent books into during the call (check_times / book_time). */
  calendar?: { provider: string; name: string } | null;
}

/** What the model is told when the workflow is at a Book step on the connected calendar. */
export const BOOK_NOW =
  "Book a time with them now. Say a few words (like \"Let me check what's free\") and call check_times. Offer two or three of the times it returns, never any other. When they pick one, repeat the day and time back once, then call book_time. If they don't want to book, call skip_booking.";

/** Where the call is, in words: the workflow's position, or the booking it's waiting on. */
function rightNow(setup: CallSetup, position: Position): string {
  const next = position.next;
  if (next.kind === "action" && setup.calendar && isLiveBooking(next.step, setup.calendar.provider)) {
    const say = position.say.length ? `Say: "${position.say.map((s) => s.text).join(" ")}" Then: ` : "";
    return `${say}${BOOK_NOW}`;
  }
  return describePosition(position);
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

/** The next line for each answer, in words for the model (from `lookahead`). */
function describeAhead(ahead: Ahead): string {
  const line = (c: Ahead["cases"][number]) => {
    const lead = c.when === "any answer" ? "- Whatever they answer:" : `- If ${c.when}:`;
    if (c.then.kind === "end") return `${lead} call note only, with no words (the call is ending and the system says goodbye).`;
    if (c.then.kind === "wait") return `${lead} call note and wait; its result says what's next.`;
    return `${lead} say "${[...c.then.say, c.then.question].join(" ")}" (ending with the question), then call note.`;
  };
  return [`When they answer, reply in one turn: first say the words out loud (a word to acknowledge, then the line below in your own words, dropping any part they've already heard, like who you are), then call note with their answer to "${ahead.field}". Words first, then the note.`, ...ahead.cases.map(line)].join("\n");
}

export function callInstructions(setup: CallSetup, position: Position, ahead?: Ahead | null): string {
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
- When they answer the current question, save it with note. If "Right now" shows what comes after their answer, give it in that same reply: a few words to acknowledge, the next line, and the note. Otherwise call note first and wait: its result tells you what to say. If you're not sure what they meant, ask again rather than noting a guess.
- Never ask a follow-up question of your own. Say each line in your own natural words, keeping its meaning, but leave out anything they've already heard on this call (if you've introduced yourself, don't do it again).
- An answer that points at something you know is still an answer: for a phone number, "this number" or "the one you're calling" means the phone number of this call (note that number if it's listed under This call, otherwise note their words).
- If they answer a question that comes later, note that too, so it isn't asked again.
- If they change an earlier answer, note the new answer.
- If they ask something else, answer briefly, then come back to the current step.
- When the workflow ends, the system says the closing line and hangs up for you.
- Call end_call yourself only when the call can't go on: they want to stop, have no time, ask not to be called again, it's a wrong number, or it's voicemail.${
      listen.length
        ? `\n- Also listen for these, and note them whenever they come up:\n${listen.map((f) => `  - ${f.key}: ${f.description || f.label}`).join("\n")}`
        : ""
    }

Right now: ${rightNow(setup, position)}${ahead ? `\n${describeAhead(ahead)}` : ""}`,
    setup.calendar
      ? `# Booking
You can book into ${setup.calendar.name}. check_times gives the free times; book_time books one.
- Only offer times check_times returned. Never say a time is booked until book_time says so.
- If none of the times suit them, ask what day or time would, and check that.
- Book in the name they gave you; ask for it if you don't have it.
- To check, move or cancel a booking they already have: find_booking, then move_booking (to a time from check_times) or cancel_booking. Repeat the day and time back before changing anything.`
      : "",
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
