// Time zones for the agent picker: every IANA zone the browser knows, labelled
// with its current UTC offset, plus what time it is there now.

const FALLBACK = ["UTC", "Australia/Sydney", "Australia/Melbourne", "Australia/Perth", "Pacific/Auckland", "Asia/Singapore", "Asia/Kolkata", "Asia/Karachi", "Asia/Dubai", "Europe/London", "Europe/Paris", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Toronto"];

export function allTimezones(): string[] {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] };
  const list = intl.supportedValuesOf?.("timeZone") ?? FALLBACK;
  return list.includes("UTC") ? list : ["UTC", ...list];
}

/** "GMT+11", "GMT-5", "GMT+5:30". */
export function offsetLabel(zone: string, at = new Date()): string {
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "shortOffset" }).formatToParts(at).find((p) => p.type === "timeZoneName");
    return part?.value === "GMT" ? "GMT+0" : part?.value ?? "";
  } catch {
    return "";
  }
}

export function timeIn(zone: string, at = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-AU", { timeZone: zone, hour: "numeric", minute: "2-digit", weekday: "short" }).format(at);
  } catch {
    return "";
  }
}

/** "Australia/Sydney" -> "Sydney (Australia)". */
export function zoneName(zone: string): string {
  const parts = zone.split("/");
  if (parts.length === 1) return zone;
  return `${parts[parts.length - 1].replace(/_/g, " ")} (${parts[0]})`;
}
