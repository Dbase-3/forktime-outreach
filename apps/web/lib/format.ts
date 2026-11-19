import type { CallJson } from "./types";

/** "3:42 PM" on the viewer's own clock. */
export function clockTime(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** "Nov 18, 3:42 PM" on the viewer's own clock. */
export function dayAndTime(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** 72 → "1m 12s". */
export function duration(seconds: number | null): string {
  if (seconds == null) return "";
  const whole = Math.max(0, Math.round(seconds));
  return whole < 60 ? `${whole}s` : `${Math.floor(whole / 60)}m ${String(whole % 60).padStart(2, "0")}s`;
}

/** What a call is doing, in a couple of words. */
export function liveLabel(call: Pick<CallJson, "status" | "stage">, repFirstName: string): string {
  if (call.status === "queued") return "Queued";
  if (call.status === "dialing") return "Ringing";
  if (call.status === "cancelled") return "Cancelled";
  if (call.status === "ended") return "Ended";
  if (call.stage === "transferring") return `Connecting to ${repFirstName}`;
  if (call.stage === "with_rep") return `With ${repFirstName}`;
  return "Talking";
}
