// Cal.com's API v2, the few calls a phone agent needs: who the key belongs to,
// its event types, free times, and booking. Paths and `cal-api-version` values
// are from Cal.com's own OpenAPI file (docs/api-reference/v2/openapi.json,
// checked 2026-11-28): each endpoint falls back to an older behaviour without
// its version header. A booking needs only a name and a time zone; email and
// phone are optional (CreateBookingAttendee).

import { type Bookable, type CalendarClient, ProviderError, providerFetch } from "./providers";

export { ProviderError as CalComError };

export interface CalEventType extends Bookable {
  id: number;
  hidden: boolean;
}

type Envelope<T> = { status?: string; data?: T; error?: { message?: string } | string; message?: string };
const said = (json: unknown) => {
  const j = json as Envelope<unknown> | null;
  if (!j || j.status !== "error") return j && !j.status && (j.error || j.message) ? String(typeof j.error === "string" ? j.error : j.error?.message || j.message) : undefined;
  return String(typeof j.error === "string" ? j.error : j.error?.message || j.message || "Cal.com said no.");
};

export class CalCom implements CalendarClient {
  constructor(
    private readonly apiKey: string,
    private readonly base = "https://api.cal.com/v2",
  ) {}

  private async request<T>(method: "GET" | "POST", path: string, version: string | null, body?: unknown): Promise<T> {
    const json = await providerFetch<Envelope<T>>("Cal.com", `${this.base}${path}`, { method, headers: { Authorization: `Bearer ${this.apiKey}`, ...(version ? { "cal-api-version": version } : {}) }, body }, said);
    return json?.data as T;
  }

  async me(): Promise<{ email: string; username: string; timeZone: string }> {
    const d = await this.request<{ email: string; username: string; timeZone: string }>("GET", "/me", null);
    return { email: d.email, username: d.username, timeZone: d.timeZone };
  }

  async eventTypes(): Promise<CalEventType[]> {
    const d = await this.request<{ id: number; title: string; lengthInMinutes: number; hidden?: boolean }[]>("GET", "/event-types", "2024-06-14");
    return (Array.isArray(d) ? d : []).map((e) => ({ id: e.id, name: e.title, minutes: e.lengthInMinutes, hidden: Boolean(e.hidden) }));
  }

  async calendars(): Promise<Bookable[]> {
    return (await this.eventTypes()).filter((t) => !t.hidden).map(({ id, name, minutes }) => ({ id, name, minutes }));
  }

  async slots(eventTypeId: string | number, from: string, to: string, timeZone: string): Promise<string[]> {
    const q = new URLSearchParams({ eventTypeId: String(eventTypeId), start: from, end: to, timeZone });
    const d = await this.request<Record<string, ({ start: string } | string)[]>>("GET", `/slots?${q}`, "2024-09-04");
    return Object.values(d ?? {})
      .flat()
      .map((s) => (typeof s === "string" ? s : s.start))
      .filter(Boolean);
  }

  async book(o: { calendarId: string | number; start: string; name: string; timeZone: string; email?: string; phone?: string; metadata?: Record<string, string> }): Promise<{ id: string; start: string }> {
    const d = await this.request<{ uid: string; start: string }>("POST", "/bookings", "2024-08-13", {
      start: new Date(o.start).toISOString(),
      eventTypeId: Number(o.calendarId),
      attendee: { name: o.name, timeZone: o.timeZone, ...(o.email ? { email: o.email } : {}), ...(o.phone ? { phoneNumber: o.phone } : {}) },
      ...(o.metadata ? { metadata: o.metadata } : {}),
    });
    return { id: d.uid, start: d.start };
  }
}
