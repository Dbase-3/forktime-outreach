// How the voice agent proves a request to /runtime is its own: an HMAC of the
// time, a one-off nonce, the method, the path and the body, with the shared
// AGENT_RUNTIME_KEY (apps/platform-agent/src/api.js signs the same way).
// A signature is good for 5 minutes and once only.

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const SIGNATURE_HEADER = "x-runtime-signature";
const WINDOW_MS = 5 * 60_000;

const bodyHash = (body: Buffer | string) => createHash("sha256").update(body).digest("hex");

export function signRuntime(key: string, method: string, path: string, body: Buffer | string, now = Date.now(), nonce = Math.random().toString(36).slice(2)): string {
  const t = Math.floor(now / 1000);
  const s = createHmac("sha256", key).update(`${t}.${nonce}.${method.toUpperCase()}.${path}.${bodyHash(body)}`).digest("hex");
  return `t=${t},n=${nonce},s=${s}`;
}

/** Remembers nonces for the window, so a captured request can't be sent again. */
export class NonceBook {
  private readonly seen = new Map<string, number>();
  use(nonce: string, now = Date.now()): boolean {
    if (this.seen.size > 50_000) for (const [n, at] of this.seen) if (now - at > WINDOW_MS) this.seen.delete(n);
    if (this.seen.has(nonce)) return false;
    this.seen.set(nonce, now);
    return true;
  }
}

export function verifyRuntime(key: string, header: string | undefined, method: string, path: string, body: Buffer | string, nonces: NonceBook, now = Date.now()): boolean {
  const parts = Object.fromEntries(String(header ?? "").split(",").map((p) => p.split("=") as [string, string]));
  const t = Number(parts.t);
  if (!parts.n || !parts.s || !Number.isFinite(t) || Math.abs(now - t * 1000) > WINDOW_MS) return false;
  const want = createHmac("sha256", key).update(`${t}.${parts.n}.${method.toUpperCase()}.${path}.${bodyHash(body)}`).digest();
  const got = Buffer.from(parts.s, "hex");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return false;
  return nonces.use(parts.n, now);
}
