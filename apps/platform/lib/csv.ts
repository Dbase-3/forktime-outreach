// Reads a contacts CSV. Name and phone columns are found by their header; every
// other column becomes a contact field, so "Purchase date" turns into a field
// an automation can use straight away.

import { toFieldKey } from "./flow-tree";

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

export interface ImportedContact {
  name: string;
  phone: string;
  email?: string;
  fields: Record<string, string>;
}

export interface CsvImport {
  contacts: ImportedContact[];
  newFields: { key: string; label: string }[];
  skipped: number; // rows with no phone number
}

const NAME = /^(full )?name$|^contact$/i;
const FIRST = /^first ?name$/i;
const LAST = /^(last ?name|surname)$/i;
const PHONE = /phone|mobile|cell/i;
const NUMBER = /^(number|tel|telephone)$/i; // only when no phone/mobile column exists
const EMAIL = /e-?mail/i;

export function importContacts(text: string): CsvImport {
  const [header, ...rows] = parseCsv(text);
  if (!header) return { contacts: [], newFields: [], skipped: 0 };
  const cols = header.map((h) => h.trim());
  const find = (re: RegExp) => cols.findIndex((c) => re.test(c));
  const phoneAt = find(PHONE);
  const at = { name: find(NAME), first: find(FIRST), last: find(LAST), phone: phoneAt !== -1 ? phoneAt : find(NUMBER), email: find(EMAIL) };
  const known = new Set(Object.values(at).filter((i) => i !== -1));
  const extra = cols.map((label, i) => ({ i, label, key: toFieldKey(label) })).filter((c) => !known.has(c.i) && c.key);

  let skipped = 0;
  const contacts = rows.flatMap((row) => {
    const get = (i: number) => (i === -1 ? "" : (row[i] ?? "").trim());
    const phone = get(at.phone);
    if (!phone) {
      skipped++;
      return [];
    }
    const name = get(at.name) || [get(at.first), get(at.last)].filter(Boolean).join(" ") || phone;
    const fields: Record<string, string> = {};
    if (get(at.first)) fields.first_name = get(at.first);
    else if (name !== phone) fields.first_name = name.split(" ")[0];
    for (const col of extra) if (get(col.i)) fields[col.key] = get(col.i);
    return [{ name, phone, email: get(at.email) || undefined, fields }];
  });
  return { contacts, newFields: extra.map(({ key, label }) => ({ key, label })), skipped };
}
