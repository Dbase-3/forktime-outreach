// What a call sends to a CRM (GoHighLevel, Twenty): who the person is, and a
// note of the call. Pure, so the API and tests agree on it.

import type { SchemaField } from "./agent-data";

export interface CallPerson {
  name?: string;
  phone?: string; // E.164
  email?: string;
}

const E164 = /^\+[1-9]\d{7,14}$/;
const asE164 = (v: string | undefined | null) => {
  const s = String(v ?? "").replace(/[\s().-]/g, "");
  return E164.test(s) ? s : undefined;
};
const asEmail = (v: string | undefined | null) => {
  const s = String(v ?? "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : undefined;
};

/**
 * Who the call was with: the contact it was made for, else what they said on
 * the call (a saved name, phone or email answer), else the number that called.
 */
export function personOf(o: { contact?: { name?: string; phoneE164?: string | null; email?: string | null } | null; saved: Record<string, string>; fromNumber?: string | null }): CallPerson {
  const saved = Object.entries(o.saved);
  const pick = (re: RegExp, read: (v: string) => string | undefined) => saved.filter(([k]) => re.test(k)).map(([, v]) => read(v)).find(Boolean);
  const first = saved.find(([k]) => /^first_?name$/i.test(k))?.[1];
  const last = saved.find(([k]) => /^last_?name$/i.test(k))?.[1];
  const savedName = pick(/^(contact_?|full_?|caller_?|customer_?)?name$/i, (v) => v.trim() || undefined) ?? ([first, last].filter(Boolean).join(" ") || undefined);
  return {
    name: o.contact?.name?.trim() || savedName,
    phone: asE164(o.contact?.phoneE164) ?? pick(/phone|mobile|number/i, asE164) ?? asE164(o.fromNumber),
    email: asEmail(o.contact?.email) ?? pick(/e-?mail/i, asEmail),
  };
}

/** The note: when, which agent, how it ended, the summary, and the answers (only `keys` when given). */
export function callNote(o: { agent: string; when: string; outcome: string; summary: string; saved: Record<string, string>; schema: Pick<SchemaField, "key" | "label">[]; keys?: string[] }): { title: string; body: string } {
  const label = new Map(o.schema.map((f) => [f.key, f.label]));
  const answers = Object.entries(o.saved)
    .filter(([k, v]) => v && (!o.keys?.length || o.keys.includes(k)))
    .map(([k, v]) => `- ${label.get(k) || k}: ${v}`);
  const outcome = o.outcome.replace(/_/g, " ");
  return {
    title: `Phone call with ${o.agent}: ${outcome}`,
    body: [`Phone call with ${o.agent} (AI assistant), ${o.when}.`, `Outcome: ${outcome}`, o.summary ? `\n${o.summary}` : "", answers.length ? `\nAnswers:\n${answers.join("\n")}` : ""].filter(Boolean).join("\n"),
  };
}
