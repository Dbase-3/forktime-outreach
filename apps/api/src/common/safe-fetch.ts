// Fetching a page someone typed in, without letting them reach our own
// network (SSRF). Every address a host name resolves to is checked inside the
// connection's own DNS lookup, so a name can't resolve to a public address for
// the check and a private one for the connection (DNS rebinding). Redirects
// are followed by hand and each hop is checked again. The body is streamed
// and cut off at the byte limit; only text content is accepted. Server only.

import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import type { LookupFunction } from "node:net";
import { isBlockedAddress } from "@outreach/core/net-guard";
import { publicUrlProblem } from "@outreach/core/knowledge";

const MAX_REDIRECTS = 4;
const TEXT_TYPES = /^(text\/|application\/(xhtml\+xml|xml|rss\+xml|atom\+xml)|$)/i;

export class FetchProblem extends Error {}

const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
    if (err) return callback(err, "", 4);
    const list = addresses as dns.LookupAddress[];
    if (list.length === 0 || list.some((a) => isBlockedAddress(a.address))) {
      return callback(new FetchProblem("That address is on a private network."), "", 4);
    }
    if ((options as dns.LookupAllOptions).all) return (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, list);
    return callback(null, list[0].address, list[0].family);
  });
};

function once(url: URL, timeoutMs: number, maxBytes: number): Promise<{ status: number; location?: string; type: string; body: string }> {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === "https:" ? https : http;
    const req = lib.get(
      url,
      {
        lookup: guardedLookup,
        timeout: timeoutMs,
        headers: { "user-agent": "LisnaKnowledgeReader/1.0", accept: "text/html,application/xml,text/xml,text/plain;q=0.9", "accept-encoding": "identity" },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const type = String(res.headers["content-type"] ?? "");
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          return resolve({ status, location: res.headers.location, type, body: "" });
        }
        if (!TEXT_TYPES.test(type.split(";")[0].trim())) {
          res.destroy();
          return reject(new FetchProblem("That address isn't a web page or text."));
        }
        const declared = Number(res.headers["content-length"] ?? 0);
        if (declared > maxBytes) {
          res.destroy();
          return reject(new FetchProblem("That page is too large to read."));
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            // Keep what fits; a page cut short is still useful knowledge.
            chunks.push(chunk.subarray(0, Math.max(0, chunk.length - (size - maxBytes))));
            res.destroy();
            resolve({ status, type, body: Buffer.concat(chunks).toString("utf8") });
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => resolve({ status, type, body: Buffer.concat(chunks).toString("utf8") }));
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new FetchProblem("The site took too long to answer.")));
    req.on("error", (err) => reject(err instanceof FetchProblem ? err : new FetchProblem(err.message.includes("private network") ? "That address is on a private network." : "That address couldn't be reached.")));
  });
}

/** GET a public text page, following up to 4 checked redirects. */
export async function safeFetchText(raw: string, opts: { timeoutMs: number; maxBytes: number }): Promise<string> {
  let current = raw;
  const deadline = Date.now() + opts.timeoutMs;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const problem = publicUrlProblem(current);
    if (problem) throw new FetchProblem(problem);
    const left = deadline - Date.now();
    if (left <= 0) throw new FetchProblem("The site took too long to answer.");
    const res = await once(new URL(current), left, opts.maxBytes);
    if (res.location) {
      current = new URL(res.location, current).toString();
      continue;
    }
    if (res.status < 200 || res.status >= 300) throw new FetchProblem(`The site answered ${res.status}.`);
    return res.body;
  }
  throw new FetchProblem("That address redirects too many times.");
}
