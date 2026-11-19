// Calls go out only inside the hours the operator set, on one clock. A
// restaurant rung during service is a restaurant that hangs up.

export interface CallingWindow {
  timezone: string;
  /** "14:00" */
  windowStart: string;
  /** "17:00" */
  windowEnd: string;
  /** 1 = Monday … 7 = Sunday. */
  windowDays: number[];
  enforceWindow: boolean;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function minutesOf(hhmm: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
}

/** The weekday (1–7) and minute of the day at `now` on the zone's clock. */
export function clockIn(now: Date, timezone: string): { day: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    day: WEEKDAYS.indexOf(part("weekday")) + 1,
    minute: Number(part("hour")) * 60 + Number(part("minute")),
  };
}

/** Whether a call may start now. A window that can't be read lets nothing through. */
export function insideCallingWindow(now: Date, window: CallingWindow): boolean {
  if (!window.enforceWindow) return true;
  const start = minutesOf(window.windowStart);
  const end = minutesOf(window.windowEnd);
  if (start == null || end == null || start >= end) return false;
  let clock: { day: number; minute: number };
  try {
    clock = clockIn(now, window.timezone);
  } catch {
    // An unknown time zone: refuse rather than guess a clock.
    return false;
  }
  return window.windowDays.includes(clock.day) && clock.minute >= start && clock.minute < end;
}

/** "2:00 PM to 5:00 PM, Mon–Fri (Australia/Darwin)" for the screen. */
export function describeWindow(window: CallingWindow): string {
  const fmt = (hhmm: string) => {
    const total = minutesOf(hhmm);
    if (total == null) return hhmm;
    const hours = Math.floor(total / 60);
    const minutes = total % 60;
    const suffix = hours >= 12 ? "PM" : "AM";
    return `${hours % 12 || 12}:${String(minutes).padStart(2, "0")} ${suffix}`;
  };
  const days = [...window.windowDays].sort((a, b) => a - b).map((d) => WEEKDAYS[d - 1]).join(", ");
  return `${fmt(window.windowStart)} to ${fmt(window.windowEnd)}, ${days} (${window.timezone})`;
}
