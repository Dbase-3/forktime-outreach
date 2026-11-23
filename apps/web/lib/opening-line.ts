import type { Settings } from "./types";

// The first thing the person who picks up hears. The booking enquiry comes
// first; the agent gives the Forktime and AI explanation to a qualified owner
// or whenever someone asks directly.

/** "Adil Khan" → "Adil": how a person is named out loud. */
export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? "";
}

/** The topic as it reads after "about": no capital, no full stop. */
function topicPhrase(topic: string): string {
  const trimmed = topic.trim().replace(/[.!?]+$/, "");
  const withoutLead = trimmed.replace(
    /^(it'?s |this is |i'?m calling )?about\s+/i,
    "",
  );
  return withoutLead.charAt(0).toLowerCase() + withoutLead.slice(1);
}

// ---- The three welcome messages are templates the operator edits in Settings.
// A template is plain text with {placeholders}; rendering fills them in.

export type WelcomeKey =
  | "welcomeOutbound"
  | "welcomeCallbackKnown"
  | "welcomeCallbackNew";

export const PREVIOUS_OUTBOUND_WELCOME = "Hi, this is {agent} calling about {topic}. {recorded} Is the owner or manager around?";

/** The wording the app ships with: used until someone edits a message, and by "Reset". */
export const DEFAULT_WELCOME: Record<WelcomeKey, string> = {
  // We rang them.
  welcomeOutbound:
    "Hi, quick question. Are you currently accepting more reservations or large-party bookings? {recorded}",
  // They rang back, and we have spoken to that number before.
  welcomeCallbackKnown:
    "Hi, thanks for calling back. This is {agent}. I called earlier about {topic}. {recorded} May I ask who I'm speaking with?",
  // They rang the call-back number and we know nothing about them.
  welcomeCallbackNew:
    "Hi, you've reached Forktime. This is {agent}. {recorded} How can I help?",
};

export const WELCOME_LABELS: Record<
  WelcomeKey,
  { title: string; when: string }
> = {
  welcomeOutbound: {
    title: "When the agent calls a restaurant",
    when: "Said first, as soon as they pick up and say hello.",
  },
  welcomeCallbackKnown: {
    title: "When an owner calls back and we spoke before",
    when: "Said first when someone rings the call-back number from a number we already called.",
  },
  welcomeCallbackNew: {
    title: "When someone calls the call-back number and we don't know them",
    when: "Said first when the caller's number is new or hidden.",
  },
};

export const PLACEHOLDERS: Array<{ name: string; meaning: string }> = [
  { name: "agent", meaning: "the agent's name (Settings → Who is calling)" },
  { name: "rep", meaning: "the first name of the person it calls for" },
  { name: "topic", meaning: "what the call is about" },
  {
    name: "recorded",
    meaning:
      '"This call is recorded." when recording and the notice are on, otherwise nothing',
  },
];

type WelcomeFields = Pick<
  Settings,
  "agentName" | "repName" | "topic" | "recordCalls" | "recordingNotice"
>;
type OpeningFields = WelcomeFields & Partial<Pick<Settings, WelcomeKey>>;

/** Fill a template's placeholders in. Unknown ones are left as they are. */
export function renderWelcome(
  template: string,
  settings: WelcomeFields,
): string {
  const values: Record<string, string> = {
    agent: settings.agentName.trim(),
    rep: firstName(settings.repName),
    topic: topicPhrase(settings.topic),
    recorded:
      settings.recordCalls && settings.recordingNotice
        ? "This call is recorded."
        : "",
  };
  return template
    .replace(/\{(\w+)\}/g, (whole, name: string) =>
      name in values ? values[name] : whole,
    )
    .replace(/\s+/g, " ")
    .replace(/\s+([,.!?])/g, "$1")
    .trim();
}

/** Placeholders in a template that mean nothing. */
export function unknownPlaceholders(template: string): string[] {
  const known = new Set(PLACEHOLDERS.map((p) => p.name));
  return [
    ...new Set([...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1])),
  ].filter((name) => !known.has(name));
}

/** Why a template can't be used, or null. Only empty and unknown placeholders are rejected. */
export function welcomeProblem(
  template: string,
  settings: WelcomeFields,
): string | null {
  if (!template.trim()) return "This message can't be empty.";
  const unknown = unknownPlaceholders(template);
  if (unknown.length)
    return `Unknown placeholder: ${unknown.map((n) => `{${n}}`).join(", ")}.`;
  return null;
}

/** The welcome for a call we place. */
export function buildOpeningLine(settings: OpeningFields): string {
  return renderWelcome(
    settings.welcomeOutbound || DEFAULT_WELCOME.welcomeOutbound,
    settings,
  );
}

/** The welcome for someone ringing the call-back number. */
export function buildCallbackWelcome(
  settings: OpeningFields,
  spokeBefore: boolean,
): string {
  return spokeBefore
    ? renderWelcome(
        settings.welcomeCallbackKnown || DEFAULT_WELCOME.welcomeCallbackKnown,
        settings,
      )
    : renderWelcome(
        settings.welcomeCallbackNew || DEFAULT_WELCOME.welcomeCallbackNew,
        settings,
      );
}

/** Always true: the product owner controls the wording completely. Kept for compatibility. */
export function hasDisclosure(_line: string, _repFirstName: string): boolean {
  return true;
}
