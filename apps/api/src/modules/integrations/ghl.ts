// GoHighLevel (LeadConnector API v2) for one sub-account, with a Private
// Integration token. Paths, `Version` headers and bodies are from GHL's own
// OpenAPI files (github.com/GoHighLevel/highlevel-api-docs apps/*.json, checked
// 2026-11-28): contacts and locations use Version 2021-07-28, calendars
// 2021-04-15; free slots take epoch milliseconds (at most 31 days); an
// appointment needs a contact, so the caller is upserted first.

import { type Bookable, type CalendarClient, type ContactInfo, type CrmClient, dayMs, localDate, ProviderError, providerFetch } from "./providers";

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

  private request<T>(method: "GET" | "POST" | "PUT", path: string, version: string, body?: unknown): Promise<T> {
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

  /**
   * A page of contacts. Search Contacts (POST /contacts/search, page + pageLimit)
   * is GHL's recommended way; its body isn't in the OpenAPI file, so if GHL
   * refuses it this falls back to the documented (deprecated) GET /contacts/
   * with startAfterId / startAfter.
   */
  async listContacts(after: string | null): Promise<{ contacts: (ContactInfo & { id: string })[]; next: string | null }> {
    type Row = { id: string; contactName?: string; firstName?: string; lastName?: string; name?: string; phone?: string; email?: string; dateAdded?: string };
    const read = (r: Row) => ({ id: r.id, name: (r.contactName || r.name || [r.firstName, r.lastName].filter(Boolean).join(" ")).trim() || undefined, phone: r.phone || undefined, email: r.email || undefined });
    const cursor = after ? (JSON.parse(after) as { page?: number; legacy?: { id: string; at: number } }) : { page: 1 };
    if (!cursor.legacy) {
      try {
        const page = cursor.page ?? 1;
        const d = await this.request<{ contacts?: Row[] }>("POST", "/contacts/search", CONTACTS, { locationId: this.locationId, page, pageLimit: 100 });
        const rows = d.contacts ?? [];
        return { contacts: rows.map(read), next: rows.length === 100 ? JSON.stringify({ page: page + 1 }) : null };
      } catch (err) {
        if (!(err instanceof ProviderError) || err.status === 401 || err.status >= 500 || (cursor.page ?? 1) > 1) throw err;
      }
    }
    const q = new URLSearchParams({ locationId: this.locationId, limit: "100", ...(cursor.legacy ? { startAfterId: cursor.legacy.id, startAfter: String(cursor.legacy.at) } : {}) });
    const d = await this.request<{ contacts?: Row[] }>("GET", `/contacts/?${q}`, CONTACTS);
    const rows = d.contacts ?? [];
    const last = rows.at(-1);
    return { contacts: rows.map(read), next: rows.length === 100 && last ? JSON.stringify({ legacy: { id: last.id, at: Date.parse(last.dateAdded ?? "") || 0 } }) : null };
  }

  /** The contact with this phone or email, if GHL has one. */
  private async findContact(who: ContactInfo): Promise<string | null> {
    for (const [key, value] of [["number", who.phone], ["email", who.email]] as const) {
      if (!value) continue;
      const d = await this.request<{ contact?: { id?: string } | null }>("GET", `/contacts/search/duplicate?${new URLSearchParams({ locationId: this.locationId, [key]: value })}`, CONTACTS);
      if (d?.contact?.id) return d.contact.id;
    }
    return null;
  }

  async upcoming(_calendarId: string | number, who: ContactInfo): Promise<{ id: string; start: string }[]> {
    if (!who.phone && !who.email) return [];
    const contactId = await this.findContact(who);
    if (!contactId) return [];
    const d = await this.request<{ events?: { id: string; startTime: string; appointmentStatus?: string; deleted?: boolean }[] }>("GET", `/contacts/${encodeURIComponent(contactId)}/appointments`, CONTACTS);
    return (d.events ?? [])
      .filter((e) => !e.deleted && e.appointmentStatus !== "cancelled" && Date.parse(e.startTime) > Date.now())
      .sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime))
      .map((e) => ({ id: e.id, start: e.startTime }));
  }

  async reschedule(id: string, start: string, minutes: number): Promise<{ id: string; start: string }> {
    const end = new Date(Date.parse(start) + minutes * 60_000).toISOString();
    const d = await this.request<{ id?: string; startTime?: string }>("PUT", `/calendars/events/appointments/${encodeURIComponent(id)}`, CALENDARS, { startTime: start, endTime: end });
    return { id: d.id || id, start: d.startTime || start };
  }

  async cancel(id: string): Promise<void> {
    await this.request("PUT", `/calendars/events/appointments/${encodeURIComponent(id)}`, CALENDARS, { appointmentStatus: "cancelled" });
  }
}
