"use strict";

// Talking to the platform API. Every request is signed with the shared
// AGENT_RUNTIME_KEY, the same way apps/api/src/common/runtime-signature.ts
// checks it. Reports go in small batches, in order; a call never waits on them.

const { createHash, createHmac, randomBytes } = require("crypto");

/** The signature header for one request. Pure apart from the clock and the nonce. */
function sign(key, method, path, body, now = Date.now(), nonce = randomBytes(12).toString("hex")) {
  const t = Math.floor(now / 1000);
  const hash = createHash("sha256").update(body || "").digest("hex");
  const s = createHmac("sha256", key).update(`${t}.${nonce}.${method.toUpperCase()}.${path}.${hash}`).digest("hex");
  return `t=${t},n=${nonce},s=${s}`;
}

function createApi({ baseUrl, key, callId, fetchImpl = fetch, log = console }) {
  const base = `/runtime/calls/${callId}`;

  async function send(method, path, payload) {
    const body = payload === undefined ? "" : JSON.stringify(payload);
    const res = await fetchImpl(`${baseUrl}${path}`, {
      method,
      headers: { "x-runtime-signature": sign(key, method, path, body), ...(body ? { "content-type": "application/json" } : {}) },
      body: body || undefined,
    });
    const text = await res.text();
    if (!res.ok) {
      const err = new Error(`${method} ${path}: ${res.status} ${text.slice(0, 200)}`);
      err.status = res.status;
      throw err;
    }
    return text ? JSON.parse(text) : null;
  }

  // ---- Reports, batched ----
  let queue = [];
  let chain = Promise.resolve();
  let timer = null;
  let closed = false;

  function flush() {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!queue.length) return chain;
    const events = queue;
    queue = [];
    chain = chain.then(async () => {
      for (const wait of [0, 400, 1200]) {
        if (wait) await new Promise((r) => setTimeout(r, wait));
        try {
          await send("POST", `${base}/events`, { events });
          return;
        } catch (err) {
          // Refused (bad shape, call over): another try would be refused too.
          if (err.status && err.status < 500) return log.warn(`[Api] events refused: ${err.message}`);
          if (wait === 1200) log.warn(`[Api] events not delivered: ${err.message}`);
        }
      }
    });
    return chain;
  }

  return {
    setup: () => send("GET", base),
    search: (query) => send("POST", `${base}/search`, { query }),
    /** Queue a report; it goes within a second, or at once for the end of the call. */
    report(event) {
      if (closed) return;
      queue.push(event);
      if (event.type === "ended") {
        closed = true;
        return flush();
      }
      if (!timer) timer = setTimeout(flush, 800);
      return undefined;
    },
    flush,
  };
}

module.exports = { sign, createApi };
