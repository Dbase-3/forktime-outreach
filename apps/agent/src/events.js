"use strict";

// Reports on a running call go to the app over HTTP, one after another so
// they arrive in order. The agent holds no database connection. A report
// that cannot be delivered is retried, then dropped with a log line: a call
// must never stall because the app is slow.

const RETRY_DELAYS_MS = [300, 900, 2000];

function createEmitter({ baseUrl, key, callId, attempt, fetchImpl = fetch, log = console, delaysMs = RETRY_DELAYS_MS }) {
  const url = `${baseUrl}/api/agent/events`;
  let chain = Promise.resolve();
  let seq = 0;

  async function post(body) {
    for (let tryIndex = 0; tryIndex <= delaysMs.length; tryIndex += 1) {
      try {
        const response = await fetchImpl(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-agent-key": key },
          body: JSON.stringify(body),
        });
        if (response.ok) return true;
        // The app refused it (bad shape, unknown call): another try would be refused too.
        if (response.status >= 400 && response.status < 500) {
          log.warn(`[Events] ${body.type} refused by the app (${response.status})`);
          return false;
        }
      } catch (err) {
        if (tryIndex === delaysMs.length) log.warn(`[Events] ${body.type} not delivered: ${err.message}`);
      }
      if (tryIndex < delaysMs.length) await new Promise((resolve) => setTimeout(resolve, delaysMs[tryIndex]));
    }
    return false;
  }

  function emit(type, fields = {}) {
    const body = { type, callId, attempt, ...fields };
    chain = chain.then(() => post(body)).catch(() => false);
    return chain;
  }

  return {
    emit,
    /** One line of the conversation; lines are numbered here so the app can keep them in order. */
    line(role, text) {
      const clean = String(text || "").trim();
      if (!clean) return chain;
      seq += 1;
      return emit("transcript", { seq, role, text: clean.slice(0, 4000), at: new Date().toISOString() });
    },
    /** Resolves when everything sent so far has been delivered or given up on. */
    flush: () => chain,
  };
}

module.exports = { createEmitter, RETRY_DELAYS_MS };
