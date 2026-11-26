"use strict";
// Fetching a page someone typed in, without letting them reach our own
// network (SSRF). Every address a host name resolves to is checked inside the
// connection's own DNS lookup, so a name can't resolve to a public address for
// the check and a private one for the connection (DNS rebinding). Redirects
// are followed by hand and each hop is checked again. The body is streamed
// and cut off at the byte limit; only text content is accepted. Server only.
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FetchProblem = void 0;
exports.safeFetchText = safeFetchText;
const node_dns_1 = __importDefault(require("node:dns"));
const node_http_1 = __importDefault(require("node:http"));
const node_https_1 = __importDefault(require("node:https"));
const net_guard_1 = require("@outreach/core/net-guard");
const knowledge_1 = require("@outreach/core/knowledge");
const MAX_REDIRECTS = 4;
const TEXT_TYPES = /^(text\/|application\/(xhtml\+xml|xml|rss\+xml|atom\+xml)|$)/i;
class FetchProblem extends Error {
}
exports.FetchProblem = FetchProblem;
const guardedLookup = (hostname, options, callback) => {
    node_dns_1.default.lookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
        if (err)
            return callback(err, "", 4);
        const list = addresses;
        if (list.length === 0 || list.some((a) => (0, net_guard_1.isBlockedAddress)(a.address))) {
            return callback(new FetchProblem("That address is on a private network."), "", 4);
        }
        if (options.all)
            return callback(null, list);
        return callback(null, list[0].address, list[0].family);
    });
};
function once(url, timeoutMs, maxBytes) {
    return new Promise((resolve, reject) => {
        const lib = url.protocol === "https:" ? node_https_1.default : node_http_1.default;
        const req = lib.get(url, {
            lookup: guardedLookup,
            timeout: timeoutMs,
            headers: { "user-agent": "ForktimeKnowledgeReader/1.0", accept: "text/html,application/xml,text/xml,text/plain;q=0.9", "accept-encoding": "identity" },
        }, (res) => {
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
            const chunks = [];
            let size = 0;
            res.on("data", (chunk) => {
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
        });
        req.on("timeout", () => req.destroy(new FetchProblem("The site took too long to answer.")));
        req.on("error", (err) => reject(err instanceof FetchProblem ? err : new FetchProblem(err.message.includes("private network") ? "That address is on a private network." : "That address couldn't be reached.")));
    });
}
/** GET a public text page, following up to 4 checked redirects. */
async function safeFetchText(raw, opts) {
    let current = raw;
    const deadline = Date.now() + opts.timeoutMs;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        const problem = (0, knowledge_1.publicUrlProblem)(current);
        if (problem)
            throw new FetchProblem(problem);
        const left = deadline - Date.now();
        if (left <= 0)
            throw new FetchProblem("The site took too long to answer.");
        const res = await once(new URL(current), left, opts.maxBytes);
        if (res.location) {
            current = new URL(res.location, current).toString();
            continue;
        }
        if (res.status < 200 || res.status >= 300)
            throw new FetchProblem(`The site answered ${res.status}.`);
        return res.body;
    }
    throw new FetchProblem("That address redirects too many times.");
}
//# sourceMappingURL=safe-fetch.js.map