// Reads a web address into plain text for the knowledge library.
// POST { url, mode: "page" | "sitemap" | "site" } → { title, text, pages } or { error }.
// Public addresses only (lib/server/safe-fetch.ts checks every resolved address and
// every redirect); each page has a time and size limit; at most 20 pages; rate-limited.

import { NextResponse } from "next/server";
import { htmlToText, isSitemapIndex, publicUrlProblem, sameSiteLinks, sitemapUrls } from "@/lib/knowledge";
import { FetchProblem, safeFetchText } from "@/lib/server/safe-fetch";
import { clientIp, fromOtherSite, makeLimiter } from "@/lib/server/rate-limit";

export const runtime = "nodejs";

const MAX_PAGES = 20;
const PAGE_TIMEOUT_MS = 10_000;
const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const MAX_TEXT_CHARS = 400_000;

// Each request can read up to 21 pages, so callers get a small allowance.
const limited = makeLimiter({ perCaller: 12, total: 200, windowMs: 60 * 60 * 1000 });

function get(url: string): Promise<string> {
  return safeFetchText(url, { timeoutMs: PAGE_TIMEOUT_MS, maxBytes: MAX_PAGE_BYTES });
}

async function readPages(urls: string[]): Promise<{ url: string; title: string; text: string }[]> {
  const out: { url: string; title: string; text: string }[] = [];
  for (let i = 0; i < urls.length; i += 4) {
    const batch = await Promise.allSettled(urls.slice(i, i + 4).map(async (url) => ({ url, ...htmlToText(await get(url)) })));
    for (const r of batch) if (r.status === "fulfilled" && r.value.text) out.push(r.value);
  }
  return out;
}

export async function POST(request: Request) {
  if (fromOtherSite(request)) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  if (limited(clientIp(request))) return NextResponse.json({ error: "That's a lot of reading for one hour. Try again a bit later." }, { status: 429 });
  let body: { url?: string; mode?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Send a url." }, { status: 400 });
  }
  const url = (body.url ?? "").trim();
  const mode = body.mode === "sitemap" || body.mode === "site" ? body.mode : "page";
  const problem = publicUrlProblem(url);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  try {
    if (mode === "page") {
      const { title, text } = htmlToText(await get(url));
      if (!text) return NextResponse.json({ error: "That page has no readable text." }, { status: 422 });
      return NextResponse.json({ title: title || new URL(url).hostname, text: text.slice(0, MAX_TEXT_CHARS), pages: 1 });
    }

    let pages: string[];
    let title: string;
    if (mode === "sitemap") {
      const xml = await get(url);
      if (isSitemapIndex(xml)) {
        // Follow up to 3 child sitemaps for their pages (an index lists sitemaps, not pages).
        const children = sitemapUrls(xml).slice(0, 3);
        const lists = await Promise.allSettled(children.map(async (child) => sitemapUrls(await get(child))));
        pages = [...new Set(lists.flatMap((r) => (r.status === "fulfilled" ? r.value : [])))].slice(0, MAX_PAGES);
      } else pages = sitemapUrls(xml).slice(0, MAX_PAGES);
      title = `${new URL(url).hostname} (sitemap)`;
      if (pages.length === 0) return NextResponse.json({ error: "No pages found in that sitemap." }, { status: 422 });
    } else {
      const home = await get(url);
      pages = [url, ...sameSiteLinks(home, url).filter((u) => u !== url)].slice(0, MAX_PAGES);
      title = htmlToText(home).title || new URL(url).hostname;
    }
    const read = await readPages(pages);
    if (read.length === 0) return NextResponse.json({ error: "None of those pages could be read." }, { status: 422 });
    const text = read.map((p) => `## ${p.title || p.url}\n${p.url}\n\n${p.text}`).join("\n\n").slice(0, MAX_TEXT_CHARS);
    return NextResponse.json({ title, text, pages: read.length });
  } catch (err) {
    const message = err instanceof FetchProblem ? err.message : "That address couldn't be read.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
