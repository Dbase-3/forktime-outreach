// Variables a line can use, like {first_name}: what's available (the call's
// own, the contact's fields, answers saved earlier in the call), which ones a
// text uses, and which it uses that don't exist. Pure.

import type { FieldDef } from "./types";

export interface Var {
  key: string;
  label: string;
}

export interface VarGroup {
  title: string;
  vars: Var[];
}

/** Filled in on every call, whoever the contact is. */
export const CALL_VARS: Var[] = [
  { key: "agent", label: "Agent's name" },
  { key: "business", label: "Your business name" },
  { key: "today", label: "Today's date" },
];

const CONTACT_BASICS: Var[] = [
  { key: "first_name", label: "First name" },
  { key: "name", label: "Full name" },
  { key: "phone", label: "Phone number" },
];

/**
 * Everything a line can use. `fields` are the contact's fields; `answers` are
 * the keys this call saves before the line is said (all Ask fields, for the
 * agent's instructions).
 */
export function variableGroups(fields: Pick<FieldDef, "key" | "label">[], answers: Pick<FieldDef, "key" | "label">[] = []): VarGroup[] {
  const answerKeys = new Set(answers.map((a) => a.key));
  const contact = [...CONTACT_BASICS, ...fields.filter((f) => !answerKeys.has(f.key)).map((f) => ({ key: f.key, label: f.label }))];
  const uniqueContact = contact.filter((v, i) => contact.findIndex((x) => x.key === v.key) === i);
  const groups: VarGroup[] = [
    { title: "This call", vars: CALL_VARS },
    { title: "Contact", vars: uniqueContact },
  ];
  if (answers.length) groups.push({ title: "Answers on this call", vars: answers.map((a) => ({ key: a.key, label: a.label })) });
  return groups;
}

/** The variables a text uses, in order, once each. */
export function varsIn(text: string): string[] {
  return [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))];
}

/** Variables the text uses that nothing fills in (likely a typo). */
export function unknownVars(text: string, groups: VarGroup[]): string[] {
  const known = new Set(groups.flatMap((g) => g.vars.map((v) => v.key)));
  return varsIn(text).filter((key) => !known.has(key));
}

/** Puts {key} where the cursor is (replacing any selection); returns the new text and where the cursor goes. */
export function insertVar(text: string, start: number, end: number, key: string): { text: string; caret: number } {
  const token = `{${key}}`;
  const before = text.slice(0, start);
  const pad = before && !/[\s([{"'“]$/.test(before) ? " " : "";
  const next = `${before}${pad}${token}${text.slice(end)}`;
  return { text: next, caret: before.length + pad.length + token.length };
}
