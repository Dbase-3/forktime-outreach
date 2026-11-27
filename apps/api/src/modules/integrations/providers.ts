// What a connected tool can do for a call, whoever makes it: a calendar offers
// free times and books; a CRM keeps the contact and a note of the call. Each
// provider client (calcom.ts, ghl.ts, twenty.ts) implements the parts it has.

import { FetchProblem, safeJsonRequest } from "../../common/safe-fetch";

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Something calls can book into: a Cal.com event type, a GHL calendar. */
export interface Bookable {
  id: string | number;
  name: string;
  minutes: number;
}

export interface CalendarClient {
  calendars(): Promise<Bookable[]>;
  /** Free start times (ISO with the zone's offset) on the dates from..to (YYYY-MM-DD, inclusive) in that zone. */
  slots(calendarId: string | number, from: string, to: string, timeZone: string): Promise<string[]>;
  book(o: { calendarId: string | number; minutes: number; start: string; name: string; timeZone: string; email?: string; phone?: string; metadata?: Record<string, string> }): Promise<{ id: string; start: string }>;
  /** This person's upcoming bookings, matched on phone or email only (never a name alone: that could show someone else's). */
  upcoming(calendarId: string | number, who: ContactInfo): Promise<{ id: string; start: string }[]>;
  reschedule(id: string, start: string, minutes: number): Promise<{ id: string; start: string }>;
  cancel(id: string, reason: string): Promise<void>;
}

export interface ContactInfo {
  name?: string;
  phone?: string; // E.164
  email?: string;
}

export interface CrmClient {
  /** Find-or-create the person; their id in the CRM. */
  upsertContact(c: ContactInfo): Promise<string>;
  addNote(contactId: string, title: string, body: string): Promise<void>;
}

const TIMEOUT_MS = 8000;

/**
 * One JSON request with a time limit; a refusal becomes a ProviderError in plain
 * words. `guarded`: the address was typed in by a user (a self-hosted server),
 * so it goes through the SSRF-safe request.
 */
export async function providerFetch<T>(name: string, url: string, init: { method: string; headers: Record<string, string>; body?: unknown; guarded?: boolean }, read: (json: unknown) => string | undefined): Promise<T> {
  const headers = { "Content-Type": "application/json", Accept: "application/json", ...init.headers };
  const body = init.body === undefined ? undefined : JSON.stringify(init.body);
  let res: { ok: boolean; status: number; text: string };
  try {
    if (init.guarded) {
      const r = await safeJsonRequest(url, { method: init.method, headers, body, timeoutMs: TIMEOUT_MS });
      res = { ok: r.status >= 200 && r.status < 300, status: r.status, text: r.text };
    } else {
      const r = await fetch(url, { method: init.method, headers, body, signal: AbortSignal.timeout(TIMEOUT_MS) });
      res = { ok: r.ok, status: r.status, text: await r.text() };
    }
  } catch (err) {
    throw new ProviderError(err instanceof FetchProblem ? err.message : `${name} didn't answer in time.`, 504);
  }
  let json: unknown = null;
  try {
    json = res.text ? JSON.parse(res.text) : null;
  } catch {
    json = null;
  }
  const said = read(json);
  if (!res.ok || said !== undefined) {
    if (res.status === 401 || res.status === 403) throw new ProviderError(`${name} didn't accept that key${said ? ` (${said.slice(0, 200)})` : ""}.`, 401);
    throw new ProviderError(said ? said.slice(0, 300) : `${name} said no (HTTP ${res.status}).`, res.status || 502);
  }
  return json as T;
}

/** Midnight UTC of a YYYY-MM-DD, as milliseconds. */
export const dayMs = (date: string) => Date.parse(`${date}T00:00:00Z`);

/** A date in a time zone (YYYY-MM-DD) for an instant. */
export function localDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}
