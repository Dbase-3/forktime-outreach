import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

export interface NumberEntry {
  phone: string;
  label: string;
}

export interface ParsedNumberList {
  entries: NumberEntry[];
  /** Lines with no usable phone number, as typed. */
  invalid: string[];
  /** Numbers that appeared more than once; the first one is kept. */
  duplicates: number;
}

/** A run of digits with the usual separators, optionally led by a plus or an opening bracket. */
const PHONE_PART = /[+(]?\d[\d\s().-]{5,}\d/;

/** E.164 for a number as typed, or null. A number without a country code is read in `country`. */
export function toE164(raw: string, country: string): string | null {
  const parsed = parsePhoneNumberFromString(raw.trim(), country.toUpperCase() as CountryCode);
  return parsed && parsed.isValid() ? parsed.number : null;
}

/**
 * One number per line, with an optional name on either side:
 * "+61 8 8941 1234", "Rosie's Diner, 08 8941 1234", "0889411234 Rosie's Diner".
 */
export function parseNumberList(text: string, country: string): ParsedNumberList {
  const entries: NumberEntry[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  let duplicates = 0;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = PHONE_PART.exec(line);
    const phone = match ? toE164(match[0], country) : null;
    if (!match || !phone) {
      invalid.push(line);
      continue;
    }
    if (seen.has(phone)) {
      duplicates += 1;
      continue;
    }
    seen.add(phone);
    const label = (line.slice(0, match.index) + " " + line.slice(match.index + match[0].length))
      .replace(/[\t,;|]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    entries.push({ phone, label });
  }

  return { entries, invalid, duplicates };
}

/** "+61889411234" → "+61 8 8941 1234" for the screen; the input back if it can't be read. */
export function formatPhone(e164: string): string {
  const parsed = parsePhoneNumberFromString(e164);
  return parsed ? parsed.formatInternational() : e164;
}

const DIGIT_WORDS = ["oh", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

/**
 * A number the way a person reads it out, in the groups it is written in:
 * "+61412345678" → "oh four one two, three four five, six seven eight".
 * The voice reads digits as words, so it can never say "four hundred and twelve".
 */
export function spokenPhone(e164: string): string {
  const parsed = parsePhoneNumberFromString(e164);
  const written = parsed ? parsed.formatNational() : e164;
  return written
    .split(/[^\d]+/)
    .filter(Boolean)
    .map((group) => [...group].map((digit) => DIGIT_WORDS[Number(digit)]).join(" "))
    .join(", ");
}
