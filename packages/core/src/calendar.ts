// Booking into a connected calendar during a call (Cal.com first, owner
// 2026-11-28). The agent checks free times, offers a few, and books the one the
// caller picks; a workflow "Book" step on that calendar waits until it's booked
// or they decline. Pure: the API, the agent and tests share these rules.

import type { Flow, Step } from "./types";

/** Calendars an agent can book into during a call. */
export const BOOKING_CALENDARS = ["calcom"] as const;
export type BookingCalendar = (typeof BOOKING_CALENDARS)[number];

export const isBookingCalendar = (id: string | undefined): id is BookingCalendar => BOOKING_CALENDARS.includes(id as BookingCalendar);

/** A "Book" step that books for real into a calendar the workspace has connected. */
export function isLiveBooking(step: Step, calendar: string | undefined): boolean {
  return Boolean(calendar && step.kind === "action" && step.action === "book" && step.integration === calendar);
}

/** The calendar this agent books into, if any: a Book step or a tool on a booking calendar the workspace has connected. */
export function bookingCalendarOf(flow: Pick<Flow, "steps"> & Partial<Pick<Flow, "tools">>, connected: string[]): BookingCalendar | null {
  const used = new Set<string>();
  const walk = (steps: Step[]) =>
    steps.forEach((s) => {
      if (s.kind === "action" && s.action === "book" && s.integration) used.add(s.integration);
      if (s.kind === "branch") (walk(s.yes), walk(s.no));
    });
  walk(flow.steps);
  for (const t of flow.tools ?? []) if (t.kind === "integration" && t.integration) used.add(t.integration);
  return BOOKING_CALENDARS.find((c) => used.has(c) && connected.includes(c)) ?? null;
}

/** Whether the workflow has a Book step on this calendar (then the agent can also decline it). */
export function hasLiveBookingStep(steps: Step[], calendar: string): boolean {
  return steps.some((s) => isLiveBooking(s, calendar) || (s.kind === "branch" && (hasLiveBookingStep(s.yes, calendar) || hasLiveBookingStep(s.no, calendar))));
}

/** "Tuesday 2 December" in a time zone. */
export function dayLabel(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-AU", { timeZone, weekday: "long", day: "numeric", month: "long" }).format(new Date(iso)).replace(",", "");
}

/** "9 am", "2:30 pm" in a time zone: the way people say it. */
export function timeLabel(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit", hour12: true }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const minute = get("minute");
  return `${get("hour")}${minute && minute !== "00" ? `:${minute}` : ""} ${get("dayPeriod").toLowerCase()}`;
}

/** "Tuesday 2 December at 9 am". */
export const whenLabel = (iso: string, timeZone: string) => `${dayLabel(iso, timeZone)} at ${timeLabel(iso, timeZone)}`;

/**
 * Free times in words for the model: a few days, a few times each, every time
 * followed by the exact value to book it with. Days come in order; a day with
 * many times is thinned out evenly so the model sees the spread, not just the morning.
 */
export function describeSlots(starts: string[], timeZone: string, o: { days?: number; perDay?: number } = {}): string {
  const days = o.days ?? 3;
  const perDay = o.perDay ?? 6;
  const byDay = new Map<string, string[]>();
  for (const s of [...starts].sort((a, b) => Date.parse(a) - Date.parse(b))) {
    const d = dayLabel(s, timeZone);
    byDay.set(d, [...(byDay.get(d) ?? []), s]);
  }
  if (!byDay.size) return "";
  const lines = [...byDay.entries()].slice(0, days).map(([day, list]) => {
    const pick = list.length <= perDay ? list : Array.from({ length: perDay }, (_, i) => list[Math.round((i * (list.length - 1)) / (perDay - 1))]);
    return `${day}: ${[...new Set(pick)].map((s) => `${timeLabel(s, timeZone)} [${s}]`).join(", ")}`;
  });
  return lines.join("\n");
}

/** A YYYY-MM-DD date plus n days (calendar days, no time zone involved). */
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Today's date (YYYY-MM-DD) in a time zone. */
export function dateIn(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
