import { createHash, timingSafeEqual } from "node:crypto";
import { env } from "./env";

// One operator login, set in the environment (ADMIN_EMAIL / ADMIN_PASSWORD).

const digest = (value: string) => createHash("sha256").update(value).digest();

/** Compared in constant time, so a wrong guess learns nothing from how long it took. */
function same(a: string, b: string): boolean {
  return timingSafeEqual(digest(a), digest(b));
}

export function credentialsMatch(email: string, password: string): boolean {
  const emailOk = same(email.trim().toLowerCase(), env.adminEmail().trim().toLowerCase());
  const passwordOk = same(password, env.adminPassword());
  return emailOk && passwordOk;
}

/** Whether a request carries the voice agent's key. */
export function agentKeyMatches(header: string | null): boolean {
  return !!header && same(header, env.agentEventsKey());
}

const MAX_TRIES = 8;
const WINDOW_MS = 10 * 60_000;
const tries = new Map<string, { count: number; resetAt: number }>();

/** A few wrong passwords from one address and the door stays shut for ten minutes. */
export function loginAllowed(address: string, now = Date.now()): boolean {
  const entry = tries.get(address);
  if (!entry || entry.resetAt <= now) return true;
  return entry.count < MAX_TRIES;
}

export function noteFailedLogin(address: string, now = Date.now()): void {
  const entry = tries.get(address);
  if (!entry || entry.resetAt <= now) tries.set(address, { count: 1, resetAt: now + WINDOW_MS });
  else entry.count += 1;
}

export function clearLoginTries(address: string): void {
  tries.delete(address);
}
