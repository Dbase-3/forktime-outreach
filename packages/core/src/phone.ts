// Phone numbers as the dialler needs them: E.164 ("+61412555019"), read in the
// workspace's country when typed locally ("0412 555 019"). Used to skip numbers
// that can't be dialled and to match the do-not-call list whatever way a number
// was written. Pure.

import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/min";

/** The workspace's country, from its time zone (AU and US first; owner 2026-11-26). */
export function countryOfZone(timezone: string): CountryCode {
  if (timezone.startsWith("Australia/")) return "AU";
  if (timezone === "Pacific/Auckland" || timezone === "Pacific/Chatham") return "NZ";
  if (timezone === "Europe/London") return "GB";
  if (/^America\/(Toronto|Vancouver|Edmonton|Winnipeg|Halifax|St_Johns|Regina)$/.test(timezone)) return "CA";
  if (timezone.startsWith("America/") || timezone.startsWith("US/")) return "US";
  if (timezone === "Asia/Kolkata") return "IN";
  if (timezone === "Asia/Karachi") return "PK";
  return "AU";
}

/** "+61412555019", or null when it can't be a real number. */
export function toE164(raw: string | undefined, country: CountryCode = "AU"): string | null {
  if (!raw?.trim()) return null;
  const parsed = parsePhoneNumberFromString(raw.trim(), country);
  return parsed && parsed.isValid() ? parsed.number : null;
}

/** The do-not-call list as E.164, so "0412 555 019" and "+61 412 555 019" match. */
export function dncSet(numbers: string[], country: CountryCode = "AU"): Set<string> {
  const out = new Set<string>();
  for (const n of numbers) {
    const e = toE164(n, country);
    if (e) out.add(e);
  }
  return out;
}
