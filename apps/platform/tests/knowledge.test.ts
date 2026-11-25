import { describe, expect, it } from "vitest";
import { attachedTo, deleteBlockedReason, docsForAgent, formatBytes, htmlToText, publicUrlProblem, sameSiteLinks, sitemapUrls, usedByLabel } from "@/lib/knowledge";
import type { Flow, KnowledgeDoc } from "@/lib/types";

const doc = (id: string, over: Partial<KnowledgeDoc> = {}): KnowledgeDoc => ({
  id, name: id, kind: "text", content: "", sizeBytes: 10, status: "ready", availableToAll: false, createdAt: "", updatedAt: "", ...over,
});
const flow = (id: string, knowledgeIds: string[]) => ({ id, name: id === "f1" ? "Service check-in" : "Front desk", knowledgeIds }) as Flow;

describe("who uses a document", () => {
  const docs = [doc("hours", { availableToAll: true }), doc("prices"), doc("old")];
  const flows = [flow("f1", ["prices"]), flow("f2", ["prices"])];

  it("an agent answers from its own documents plus those available to all", () => {
    expect(docsForAgent({ knowledge: docs }, flows[0]).map((d) => d.id)).toEqual(["hours", "prices"]);
  });

  it("labels and counts users", () => {
    expect(usedByLabel(docs[0], flows)).toBe("All agents");
    expect(usedByLabel(docs[1], flows)).toBe("2 agents");
    expect(usedByLabel(docs[2], flows)).toBe("Not used yet");
    expect(attachedTo(docs[1], flows).map((f) => f.id)).toEqual(["f1", "f2"]);
  });

  it("blocks deleting a document an agent still uses, and says which", () => {
    expect(deleteBlockedReason(docs[1], flows)).toBe("Service check-in, Front desk use it. Remove it from those agents first.");
    expect(deleteBlockedReason(docs[0], flows)).toMatch(/available to all agents/);
    expect(deleteBlockedReason(docs[2], flows)).toBeNull();
  });

  it("formats sizes", () => {
    expect([512, 7680, 2.5 * 1024 * 1024].map(formatBytes)).toEqual(["512 B", "7.5 kB", "2.5 MB"]);
  });
});

describe("reading websites", () => {
  it("keeps the readable text and the title, drops scripts, styles and tags", () => {
    const html = `<html><head><title>Northside &amp; Co</title><style>p{}</style><script>alert(1)</script></head>
      <body><nav><a href="/">Home</a></nav><h1>Service</h1><p>Open 9&nbsp;to 5.</p><!-- hidden --><ul><li>Free first service</li></ul></body></html>`;
    expect(htmlToText(html)).toEqual({ title: "Northside & Co", text: "Home\nService\nOpen 9 to 5.\nFree first service" });
  });

  it("lists sitemap pages once each", () => {
    const xml = `<urlset><url><loc> https://a.com/x?a=1&amp;b=2 </loc></url><url><loc>https://a.com/y</loc></url><url><loc>https://a.com/y</loc></url></urlset>`;
    expect(sitemapUrls(xml)).toEqual(["https://a.com/x?a=1&b=2", "https://a.com/y"]);
  });

  it("follows only same-site page links", () => {
    const html = `<a href="/about">a</a><a href="https://a.com/menu#top">m</a><a href="https://other.com/x">o</a><a href="/logo.png">i</a><a href="mailto:x@a.com">e</a>`;
    expect(sameSiteLinks(html, "https://a.com/")).toEqual(["https://a.com/about", "https://a.com/menu"]);
  });

  it("refuses non-public addresses", () => {
    expect(publicUrlProblem("https://northside.com.au")).toBeNull();
    expect(publicUrlProblem("ftp://x.com")).toMatch(/http/);
    expect(publicUrlProblem("http://localhost:3000")).toMatch(/private/);
    expect(publicUrlProblem("http://192.168.1.4/admin")).toMatch(/private/);
    expect(publicUrlProblem("http://10.0.0.1")).toMatch(/private/);
    expect(publicUrlProblem("http://intranet")).toMatch(/full domain/);
    expect(publicUrlProblem("not a url")).toMatch(/isn't a web address/);
  });
});
