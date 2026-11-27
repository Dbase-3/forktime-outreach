// GoHighLevel (LeadConnector API v2) for one sub-account, with a Private
// Integration token. Paths, `Version` headers and bodies are from GHL's own
// OpenAPI files (github.com/GoHighLevel/highlevel-api-docs apps/*.json, checked
// 2026-11-28): contacts and locations use Version 2021-07-28, calendars
// 2021-04-15; free slots take epoch milliseconds (at most 31 days); an
// appointment needs a contact, so the caller is upserted first.

import { type Bookable, type CalendarClient, type ContactInfo, type CrmClient, dayMs, localDate, providerFetch } from "./providers";

const CONTACTS = "2021-07-28";
const CALENDARS = "2021-04-15";

const said = (json: unknown) => {
  const j = json as { statusCode?: number; message?: string | string[]; error?: string } | null;
  if (!j || typeof j.statusCode !== "number" || j.statusCode < 400) return undefined;
  return Array.isArray(j.message) ? j.message.join("; ") : j.message || j.error || "GoHighLevel said no.";
};

export class Ghl implements CalendarClient, CrmClient {
  constructor(
    private readonly token: string,
    readonly locationId: string,
    private readonly base = "https://services.leadconnectorhq.com",
  ) {}

  private request<T>(method: "GET" | "POST", path: string, version: string, body?: unknown): Promise<T> {
    return providerFetch<T>("GoHighLevel", `${this.base}${path}`, { method, headers: { Authorization: `Bearer ${this.token}`, Version: version }, body }, said);
  }

  /** The sub-account's name (needs the locations.readonly scope; null without it). */
  async locationName(): Promise<string | null> {
    try {
      const d = await this.request<{ location?: { name?: string } }>("GET", `/locations/${encodeURIComponent(this.locationId)}`, CONTACTS);
      return d.location?.name || null;
    } catch {
      return null;
    }
  }

  async calendars(): Promise<Bookable[]> {
    const d = await this.request<{ calendars?: { id: string; name: string; isActive?: boolean; slotDuration?: number; slotDurationUnit?: string }[] }>("GET", `/calendars/?locationId=${encodeURIComponent(this.locationId)}`, CALENDARS);
    return (d.calendars ?? []).filter((c) => c.isActive !== false).map((c) => ({ id: c.id, name: c.name, minutes: (c.slotDuration ?? 30) * (c.slotDurationUnit === "hours" ? 60 : 1) }));
  }

  async slots(calendarId: string | number, from: string, to: string, timeZone: string): Promise<string[]> {
    // A day either side covers every time zone; the dates are then read in the zone.
    const start = Math.max(Date.now(), dayMs(from) - 86_400_000);
    const end = dayMs(to) + 2 * 86_400_000 - 1;
    const q = new URLSearchParams({ startDate: String(start), endDate: String(end), timezone: timeZone });
    const d = await this.request<Record<string, { slots?: string[] } | unknown>>("GET", `/calendars/${encodeURIComponent(String(calendarId))}/free-slots?${q}`, CALENDARS);
    return Object.values(d ?? {})
      .flatMap((v) => (v && typeof v === "object" && Array.isArray((v as { slots?: unknown }).slots) ? ((v as { slots: string[] }).slots) : []))
      .filter((s) => {
        const day = localDate(s, timeZone);
        return day >= from && day <= to;
      });
  }

  async upsertContact(c: ContactInfo): Promise<string> {
    const [firstName, ...rest] = (c.name ?? "").trim().split(/\s+/);
    const d = await this.request<{ contact?: { id: string } }>("POST", "/contacts/upsert", CONTACTS, {
      locationId: this.locationId,
      ...(c.name ? { name: c.name.trim(), firstName, ...(rest.length ? { lastName: rest.join(" ") } : {}) } : {}),
      ...(c.phone ? { phone: c.phone } : {}),
      ...(c.email ? { email: c.email } : {}),
      source: "Lisna phone call",
    });
    if (!d.contact?.id) throw new Error("GoHighLevel didn't return the contact.");
    return d.contact.id;
  }

  async addNote(contactId: string, title: string, body: string): Promise<void> {
    await this.request("POST", `/contacts/${encodeURIComponent(contactId)}/notes`, CONTACTS, { title: title.slice(0, 200), body: body.slice(0, 5000) });
  }

  async book(o: { calendarId: string | number; minutes: number; start: string; name: string; timeZone: string; email?: string; phone?: string }): Promise<{ id: string; start: string }> {
    const contactId = await this.upsertContact({ name: o.name, phone: o.phone, email: o.email });
    const end = new Date(Date.parse(o.start) + o.minutes * 60_000).toISOString();
    const d = await this.request<{ id: string; startTime?: string }>("POST", "/calendars/events/appointments", CALENDARS, {
      calendarId: String(o.calendarId),
      locationId: this.locationId,
      contactId,
      startTime: o.start,
      endTime: end,
      title: `${o.name} (booked on a call)`,
      appointmentStatus: "confirmed",
    });
    return { id: d.id, start: d.startTime || o.start };
  }
}
