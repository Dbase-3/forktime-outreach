// Cal.com's API v2, the few calls a phone agent needs: who the key belongs to,
// its event types, free times, and booking. Paths and `cal-api-version` values
// are from Cal.com's own OpenAPI file (docs/api-reference/v2/openapi.json,
// checked 2026-11-28): each endpoint falls back to an older behaviour without
// its version header. A booking needs only a name and a time zone; email and
// phone are optional (CreateBookingAttendee).

export class CalComError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface CalEventType {
  id: number;
  name: string;
  minutes: number;
  hidden: boolean;
}

const TIMEOUT_MS = 8000;

export class CalCom {
  constructor(
    private readonly apiKey: string,
    private readonly base = "https://api.cal.com/v2",
  ) {}

  private async request<T>(method: "GET" | "POST", path: string, version: string | null, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.base}${path}`, {
        method,
        headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json", ...(version ? { "cal-api-version": version } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new CalComError("Cal.com didn't answer in time.", 504);
    }
    const json = (await res.json().catch(() => null)) as { status?: string; data?: unknown; error?: { message?: string } | string; message?: string } | null;
    if (!res.ok || json?.status === "error") {
      if (res.status === 401 || res.status === 403) throw new CalComError("Cal.com didn't accept that API key.", 401);
      const raw = typeof json?.error === "string" ? json.error : json?.error?.message || json?.message;
      throw new CalComError(raw ? String(raw).slice(0, 300) : `Cal.com said no (HTTP ${res.status}).`, res.status || 502);
    }
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

  /** Free start times (ISO, with the zone's offset) between two dates, inclusive. */
  async slots(eventTypeId: number, start: string, end: string, timeZone: string): Promise<string[]> {
    const q = new URLSearchParams({ eventTypeId: String(eventTypeId), start, end, timeZone });
    const d = await this.request<Record<string, ({ start: string } | string)[]>>("GET", `/slots?${q}`, "2024-09-04");
    return Object.values(d ?? {})
      .flat()
      .map((s) => (typeof s === "string" ? s : s.start))
      .filter(Boolean);
  }

  async book(o: { eventTypeId: number; start: string; name: string; timeZone: string; email?: string; phone?: string; metadata?: Record<string, string> }): Promise<{ uid: string; start: string }> {
    const d = await this.request<{ uid: string; start: string }>("POST", "/bookings", "2024-08-13", {
      start: new Date(o.start).toISOString(),
      eventTypeId: o.eventTypeId,
      attendee: { name: o.name, timeZone: o.timeZone, ...(o.email ? { email: o.email } : {}), ...(o.phone ? { phoneNumber: o.phone } : {}) },
      ...(o.metadata ? { metadata: o.metadata } : {}),
    });
    return { uid: d.uid, start: d.start };
  }
}
