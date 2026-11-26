// The Contacts table: columns, sorting, filtering, paging and export. Pure.

import { dateOrderOf, groupHolds, toIsoDate } from "./conditions";
import { toE164 } from "./phone";
import { parseCsv } from "./csv";
import { toFieldKey } from "./flow-tree";
import { guessType } from "./conditions";
import type { Call, ConditionGroup, Contact, FieldDef, FieldType } from "./types";

/** Built-in columns every contact has; the rest come from field definitions. */
export const BUILT_INS: FieldDef[] = [
  { key: "name", label: "Name", type: "text" },
  { key: "phone", label: "Phone", type: "phone" },
  { key: "email", label: "Email", type: "email" },
  { key: "lists", label: "Lists", type: "text" },
  { key: "last_call", label: "Last call", type: "date" },
  { key: "last_outcome", label: "Last outcome", type: "text" },
  { key: "created", label: "Added", type: "date" },
];

export function allColumns(defs: FieldDef[]): FieldDef[] {
  return [...BUILT_INS, ...defs.filter((d) => !BUILT_INS.some((b) => b.key === d.key))];
}

/** A contact flattened to plain values, so built-ins and custom fields sort and filter alike. */
export function rowValues(contact: Contact, calls: Call[]): Record<string, string> {
  const mine = calls.filter((c) => c.contactId === contact.id && !c.live).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return {
    ...contact.fields,
    name: contact.name,
    phone: contact.phone,
    email: contact.email ?? "",
    lists: contact.groups.join(", "),
    last_call: mine[0]?.startedAt.slice(0, 10) ?? "",
    last_outcome: mine[0]?.outcome ?? "",
    created: contact.createdAt.slice(0, 10),
  };
}

export interface Sort {
  key: string;
  dir: "asc" | "desc";
}

function compare(a: string, b: string, type: FieldType): number {
  if (a === "" && b === "") return 0;
  if (a === "") return 1; // blanks last, whichever way
  if (b === "") return -1;
  if (type === "number") return Number(a.replace(/[,$\s]/g, "")) - Number(b.replace(/[,$\s]/g, ""));
  if (type === "date") return new Date(a).getTime() - new Date(b).getTime();
  return a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
}

export interface TableQuery {
  search: string;
  list: string | null;
  filter: ConditionGroup;
  sort: Sort;
  page: number;
  pageSize: number;
}

export interface TableRow {
  contact: Contact;
  values: Record<string, string>;
}

export interface TableResult {
  rows: TableRow[]; // this page
  matching: TableRow[]; // every row that matches, sorted
  total: number;
  pages: number;
}

export function runQuery(contacts: Contact[], calls: Call[], defs: FieldDef[], q: TableQuery, now = new Date()): TableResult {
  const columns = allColumns(defs);
  const type = columns.find((c) => c.key === q.sort.key)?.type ?? "text";
  const needle = q.search.trim().toLowerCase();
  const matching = contacts
    .map((contact) => ({ contact, values: rowValues(contact, calls) }))
    .filter((r) => !q.list || r.contact.groups.includes(q.list))
    .filter((r) => !needle || [r.values.name, r.values.phone, r.values.email].some((v) => v.toLowerCase().includes(needle)))
    .filter((r) => groupHolds(q.filter, r.values, now))
    .sort((a, b) => {
      const diff = compare(a.values[q.sort.key] ?? "", b.values[q.sort.key] ?? "", type);
      const blankA = (a.values[q.sort.key] ?? "") === "";
      const blankB = (b.values[q.sort.key] ?? "") === "";
      if (blankA !== blankB) return blankA ? 1 : -1;
      return q.sort.dir === "asc" ? diff : -diff;
    });
  const pages = Math.max(1, Math.ceil(matching.length / q.pageSize));
  const page = Math.min(Math.max(1, q.page), pages);
  return { rows: matching.slice((page - 1) * q.pageSize, page * q.pageSize), matching, total: matching.length, pages };
}

/** CSV of the given rows and columns, quoted where needed. */
export function toCsv(rows: TableRow[], columns: FieldDef[]): string {
  const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [columns.map((c) => cell(c.label)).join(","), ...rows.map((r) => columns.map((c) => cell(r.values[c.key] ?? "")).join(","))].join("\n");
}

// ---- Importing a CSV: every column, its samples, a guessed type and where it should go ----

export type Target = "name" | "first_name" | "last_name" | "phone" | "email" | "skip" | `field:${string}`;

export interface ImportColumn {
  index: number;
  name: string;
  samples: string[];
  type: FieldType;
  target: Target;
  label: string; // the new field's name when target is a new field
}

const GUESS: [RegExp, Target][] = [
  [/^(full ?name|name|contact|customer)$/i, "name"],
  [/^first ?name$/i, "first_name"],
  [/^(last ?name|surname)$/i, "last_name"],
  [/phone|mobile|cell|^tel/i, "phone"],
  [/e-?mail/i, "email"],
];

export function analyzeCsv(text: string, defs: FieldDef[]): { columns: ImportColumn[]; rows: string[][] } {
  const [header = [], ...rows] = parseCsv(text);
  const taken = new Set<Target>();
  const columns = header.map((raw, index) => {
    const name = raw.trim() || `Column ${index + 1}`;
    const samples = rows.slice(0, 50).map((r) => (r[index] ?? "").trim());
    let target: Target = GUESS.find(([re]) => re.test(name))?.[1] ?? `field:${toFieldKey(name)}`;
    if (taken.has(target)) target = `field:${toFieldKey(name)}`;
    taken.add(target);
    const existing = defs.find((d) => d.key === toFieldKey(name));
    const type = target === "phone" ? "phone" : target === "email" ? "email" : existing?.type ?? guessType(samples);
    return { index, name, samples: samples.filter(Boolean).slice(0, 3), type, target, label: name };
  });
  return { columns, rows };
}

/** One row the import left out or could only partly read. `row` is the index into the rows given. */
export interface ImportProblem {
  row: number;
  reason: "no_phone" | "already_here" | "repeated" | "bad_phone" | "unreadable";
  column?: string;
  value?: string;
}

export const IMPORT_PROBLEM_TEXT: Record<ImportProblem["reason"], string> = {
  no_phone: "No phone number: not added",
  already_here: "Number already in your contacts: not added again",
  repeated: "Same number earlier in the file: not added again",
  bad_phone: "Phone number can't be dialled: added, but campaigns skip it",
  unreadable: "Value doesn't fit the field's type: added, kept as written",
};

export interface ImportPlan {
  contacts: Omit<Contact, "id" | "createdAt">[];
  newFields: FieldDef[];
  skipped: number; // rows with no phone
  duplicates: number; // rows whose number is already a contact, or earlier in the file
  problems: ImportProblem[]; // every row above, plus rows added with an undiallable number or an unreadable value
}

const NUMBERISH = /^[-+]?[$€£]?\s*[\d,]*\.?\d+\s*%?$/;

export function planImport(columns: ImportColumn[], rows: string[][], list: string, defs: FieldDef[], sourceId: string, existing: Pick<Contact, "phone">[] = [], country: Parameters<typeof toE164>[1] = "AU"): ImportPlan {
  const fieldCols = columns.filter((c) => c.target.startsWith("field:"));
  // Date columns are stored as YYYY-MM-DD, read the way round their own values show (B18).
  const typeOf = (c: ImportColumn) => defs.find((d) => d.key === c.target.slice(6))?.type ?? c.type;
  const dateOrder = new Map(fieldCols.filter((c) => typeOf(c) === "date").map((c) => [c.index, dateOrderOf(rows.map((r) => r[c.index] ?? ""))]));
  // One contact per number: within the file and against contacts already here (audit: re-imports duplicated everyone).
  const already = new Set(existing.map((c) => toE164(c.phone, country) ?? c.phone.replace(/\s/g, "")));
  const seen = new Set<string>();
  const problems: ImportProblem[] = [];
  let duplicates = 0;
  const newFields = fieldCols
    .map((c) => ({ key: c.target.slice(6), label: c.label.trim() || c.name, type: c.type, source: sourceId }))
    .filter((f, i, all) => f.key && !defs.some((d) => d.key === f.key) && all.findIndex((x) => x.key === f.key) === i);
  const at = (t: Target) => columns.find((c) => c.target === t)?.index ?? -1;
  let skipped = 0;
  const contacts = rows.flatMap((row, index) => {
    const get = (i: number) => (i < 0 ? "" : (row[i] ?? "").trim());
    const phone = get(at("phone"));
    if (!phone) {
      skipped++;
      problems.push({ row: index, reason: "no_phone" });
      return [];
    }
    const e164 = toE164(phone, country);
    const phoneKey = e164 ?? phone.replace(/\s/g, "");
    if (already.has(phoneKey) || seen.has(phoneKey)) {
      duplicates++;
      problems.push({ row: index, reason: already.has(phoneKey) ? "already_here" : "repeated", value: phone });
      return [];
    }
    seen.add(phoneKey);
    if (!e164) problems.push({ row: index, reason: "bad_phone", value: phone });
    const first = get(at("first_name"));
    const name = get(at("name")) || [first, get(at("last_name"))].filter(Boolean).join(" ") || phone;
    const fields: Record<string, string> = {};
    if (first || name !== phone) fields.first_name = first || name.split(" ")[0];
    for (const c of fieldCols) {
      const value = get(c.index);
      if (!value) continue;
      const order = dateOrder.get(c.index);
      const iso = order ? toIsoDate(value, order) : null;
      const type = typeOf(c);
      if ((type === "date" && !iso) || (type === "number" && !NUMBERISH.test(value))) problems.push({ row: index, reason: "unreadable", column: c.label.trim() || c.name, value });
      fields[c.target.slice(6)] = iso ?? value;
    }
    return [{ name, phone, email: get(at("email")) || undefined, groups: list.trim() ? [list.trim()] : [], fields, sourceId }];
  });
  return { contacts, newFields, skipped, duplicates, problems };
}
