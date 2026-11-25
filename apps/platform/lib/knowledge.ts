// The knowledge library: what an agent can answer from. One library for the
// workspace (as in ElevenLabs): a document is either available to every agent
// or attached to the agents that need it, and can't be deleted while in use.
// Pure helpers, also used by the server route that reads websites.

import type { AppState, Flow, KnowledgeDoc } from "./types";

export const KIND_LABEL: Record<KnowledgeDoc["kind"], string> = {
  url: "Web page",
  sitemap: "Sitemap",
  site: "Website",
  file: "File",
  text: "Text",
};

/** Files read in the browser. Others wait for the backend to extract their text. */
export const READABLE_FILE = /\.(txt|md|markdown|csv|json|html?|xml)$/i;
export const MAX_FILE_BYTES = 15 * 1024 * 1024;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Every document an agent answers from: its own plus those available to all. */
export function docsForAgent(state: Pick<AppState, "knowledge">, flow: Pick<Flow, "knowledgeIds">): KnowledgeDoc[] {
  return state.knowledge.filter((d) => d.availableToAll || flow.knowledgeIds.includes(d.id));
}

/** The agents a document is attached to by name (not counting "available to all"). */
export function attachedTo(doc: Pick<KnowledgeDoc, "id">, flows: Pick<Flow, "id" | "name" | "knowledgeIds">[]): Pick<Flow, "id" | "name">[] {
  return flows.filter((f) => f.knowledgeIds.includes(doc.id));
}

export function usedByLabel(doc: KnowledgeDoc, flows: Flow[]): string {
  if (doc.availableToAll) return "All agents";
  const n = attachedTo(doc, flows).length;
  if (n === 0) return "Not used yet";
  return n === 1 ? "1 agent" : `${n} agents`;
}

/** Blocked while any agent depends on it, so nothing silently loses what it knew. */
export function deleteBlockedReason(doc: KnowledgeDoc, flows: Flow[]): string | null {
  if (doc.availableToAll) return "It's available to all agents. Turn that off first.";
  const users = attachedTo(doc, flows);
  if (users.length === 0) return null;
  return `${users.map((u) => u.name).join(", ")} ${users.length === 1 ? "uses" : "use"} it. Remove it from ${users.length === 1 ? "that agent" : "those agents"} first.`;
}

// ---- Reading websites (used by app/api/knowledge/fetch) ----

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

/** The readable text of a page: no scripts, styles, nav chrome or tags; one blank line between blocks. */
export function htmlToText(html: string): { title: string; text: string } {
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/\s+/g, " ").trim();
  const body = html
    .replace(/<head[\s\S]*?<\/head>/i, " ")
    .replace(/<(script|style|noscript|svg|template|iframe)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|section|article|li|ul|ol|h[1-6]|tr|table|br|header|footer|main|nav|aside|form|blockquote|dd|dt)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#?\w+);/g, (m, e: string) => ENTITIES[e.toLowerCase()] ?? (e.startsWith("#") ? String.fromCharCode(Number(e.slice(1))) || m : m));
  const text = body
    .split("\n")
    .map((line) => line.replace(/[ \t\f\v]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
  return { title: decodeTitle(title), text };
}

function decodeTitle(title: string): string {
  return title.replace(/&(#?\w+);/g, (m, e: string) => ENTITIES[e.toLowerCase()] ?? m);
}

/** Page addresses listed in a sitemap (or a sitemap index), in order, de-duplicated. */
export function sitemapUrls(xml: string): string[] {
  return [...new Set([...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1].replace(/&amp;/g, "&")))];
}

/** Links on a page that stay on the same site, absolute, without #fragments, de-duplicated. */
export function sameSiteLinks(html: string, base: string): string[] {
  const origin = new URL(base).origin;
  const out = new Set<string>();
  for (const m of html.matchAll(/<a\s[^>]*href\s*=\s*["']([^"']+)["']/gi)) {
    if (m[1].startsWith("#")) continue;
    try {
      const url = new URL(m[1], base);
      if (url.origin !== origin || !/^https?:$/.test(url.protocol)) continue;
      if (/\.(png|jpe?g|gif|svg|webp|pdf|zip|mp4|mp3|ico|css|js)$/i.test(url.pathname)) continue;
      url.hash = "";
      out.add(url.toString());
    } catch {
      // not a URL
    }
  }
  return [...out];
}

/**
 * Only public web addresses: http(s), a real hostname, not this machine or a
 * private network (so the reader can't be pointed at internal services).
 */
export function publicUrlProblem(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return "That isn't a web address. It should start with https://";
  }
  if (!/^https?:$/.test(url.protocol)) return "Only http and https addresses can be read.";
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return "That address is on a private network.";
  if (/^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) || host === "::1" || host.startsWith("[")) return "That address is on a private network.";
  if (!host.includes(".")) return "That address needs a full domain, like example.com.";
  return null;
}
