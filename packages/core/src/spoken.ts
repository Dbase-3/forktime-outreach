// The preview runs the workflow without a model, so it needs everyday replies
// ("yeah sure", "a booking please", "about eight") turned into what the step
// saves. Only the preview uses this; on real calls the agent understands them.

import type { Step } from "./types";

type Ask = Extract<Step, { kind: "ask" }>;

const YES = /^(yes|yeah|yep|yup|ya|yea|sure|of course|definitely|absolutely|correct|right|ok|okay|please|i do|i am|i would|that'?s right|sounds good|go ahead)\b/;
const NO = /^(no|nope|nah|not really|not now|not yet|no thanks|never|i don'?t|i'?m not|i wouldn'?t|negative)\b/;

const NUMBERS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
};

function clean(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, " ").replace(/\s+/g, " ").trim();
}

/** What the step saves for this reply. Unclear replies are kept as said. */
export function readAnswer(ask: Pick<Ask, "answerType" | "choices">, said: string): string {
  const raw = said.trim();
  const text = clean(raw);
  if (!text) return raw;
  if (ask.answerType === "yesno") {
    if (NO.test(text)) return "No";
    if (YES.test(text)) return "Yes";
    return raw;
  }
  if (ask.answerType === "choice") {
    const choices = ask.choices ?? [];
    const exact = choices.find((c) => clean(c) === text);
    if (exact) return exact;
    // The longest choice heard inside the reply wins ("a booking please" -> "Booking").
    const heard = choices.filter((c) => clean(c) && ` ${text} `.includes(` ${clean(c)} `)).sort((a, b) => b.length - a.length);
    if (heard[0]) return heard[0];
    // Or the first word of a choice ("move it" -> "Move").
    const first = choices.find((c) => text.split(" ").includes(clean(c).split(" ")[0]));
    return first ?? raw;
  }
  if (ask.answerType === "number") {
    const digits = text.match(/-?\d+(\.\d+)?/);
    if (digits) return digits[0];
    const word = text.split(" ").find((w) => w in NUMBERS);
    return word !== undefined ? String(NUMBERS[word]) : raw;
  }
  return raw;
}
