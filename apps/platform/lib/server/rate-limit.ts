// Best-effort limits for the public review deploy (no sign-in yet): per caller
// and in total, per server instance. The backend replaces this with
// per-workspace limits in Redis (docs/PLATFORM_ROADMAP.md, Phase 1).

/** The caller's address. Vercel sets x-real-ip itself; x-forwarded-for is the fallback. */
export function clientIp(request: Request): string {
  return request.headers.get("x-real-ip")?.trim() || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

export function makeLimiter({ perCaller, total, windowMs }: { perCaller: number; total: number; windowMs: number }) {
  const hits = new Map<string, number[]>();
  let all: number[] = [];
  return function limited(key: string, now = Date.now()): boolean {
    const since = now - windowMs;
    all = all.filter((t) => t > since);
    if (all.length >= total) return true;
    const mine = (hits.get(key) ?? []).filter((t) => t > since);
    if (mine.length >= perCaller) {
      hits.set(key, mine);
      return true;
    }
    mine.push(now);
    all.push(now);
    hits.set(key, mine);
    // Drop callers with nothing left in the window, so the map can't grow forever.
    if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => t > since)) hits.delete(k);
    return false;
  };
}

/** Browsers send these on every fetch; a request from another site's page is refused. */
export function fromOtherSite(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  return site !== null && site !== "same-origin" && site !== "none";
}
