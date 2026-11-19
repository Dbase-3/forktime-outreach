import type { Settings } from "./types";

// The first thing the person who picks up hears. It always says three things
// before anything else: this is an AI assistant, who it is calling for, and
// what the call is about. The agent speaks it word for word and refuses a
// line without them (apps/agent/src/opening.js mirrors `hasDisclosure`).

type OpeningFields = Pick<Settings, "agentName" | "repName" | "company" | "topic" | "recordCalls" | "recordingNotice">;

/** "Adil Khan" → "Adil": how a person is named out loud. */
export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? "";
}

/** The topic as it reads after "about": no capital, no full stop. */
function topicPhrase(topic: string): string {
  const trimmed = topic.trim().replace(/[.!?]+$/, "");
  const withoutLead = trimmed.replace(/^(it'?s |this is |i'?m calling )?about\s+/i, "");
  return withoutLead.charAt(0).toLowerCase() + withoutLead.slice(1);
}

export function buildOpeningLine(settings: OpeningFields): string {
  const notice = settings.recordCalls && settings.recordingNotice ? " This call is recorded." : "";
  return (
    `Hi, this is ${settings.agentName.trim()}, an AI assistant calling for ${firstName(settings.repName)} ` +
    `at ${settings.company.trim()}, about ${topicPhrase(settings.topic)}.${notice} ` +
    `Is the owner or manager around?`
  );
}

/** Whether a line says it is an AI and names the company. */
export function hasDisclosure(line: string, company: string): boolean {
  const said = line.toLowerCase();
  return /\bai\b/.test(said) && company.trim().length > 0 && said.includes(company.trim().toLowerCase());
}
