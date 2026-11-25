"use strict";

// Saving a Forkmate request taken on the phone: the same records, team email
// and admin page as the forms on forkmate.com.au. Backend: forktime-core
// `POST /api/forkmate/phone/{enquiries,venues}`, key `FORKMATE_PHONE_KEY`
// sent as `x-forkmate-key`.

const PATHS = { booking: "enquiries", venue: "venues" };
const TIMEOUT_MS = 8000;

/** The backend's reason for a refusal, in its own words. Pure. */
function refusalText(body) {
  const message = body && body.message;
  const text = Array.isArray(message) ? message[0] : message;
  return typeof text === "string" && text.trim() ? text.trim() : "";
}

/**
 * Send one request. Answers { saved: true, reference } or
 * { saved: false, reason, unreachable } — `unreachable` means try nothing else
 * on this call: the key is missing, the server is down, or it timed out.
 */
async function saveForkmateRequest(kind, body, { baseUrl, key, fetchImpl = fetch, log = console } = {}) {
  if (!baseUrl || !key) {
    log.warn("[Forkmate] FORKMATE_API_URL or FORKMATE_PHONE_KEY is not set; the request was not saved");
    return { saved: false, unreachable: true, reason: "not set up" };
  }
  const url = `${baseUrl}/api/forkmate/phone/${PATHS[kind]}`;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-forkmate-key": key },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const data = await response.json().catch(() => null);
      if (response.ok && data && data.data && data.data.reference) return { saved: true, reference: data.data.reference };
      // A 400 is about an answer the caller can fix; anything else is ours.
      if (response.status === 400) return { saved: false, unreachable: false, reason: refusalText(data) || "One of the answers was not accepted." };
      log.warn(`[Forkmate] save refused (${response.status}) ${refusalText(data)}`);
      if (response.status < 500) return { saved: false, unreachable: true, reason: `refused (${response.status})` };
    } catch (err) {
      log.warn(`[Forkmate] save failed (try ${attempt}): ${err.message}`);
    }
  }
  return { saved: false, unreachable: true, reason: "no answer" };
}

/** What the model hears back from a save tool. Pure. */
function saveReply(result) {
  if (result.saved) return `Saved (${result.reference}). Now call end_call with the closing line as the goodbye.`;
  if (result.unreachable) return "Not saved: the system can't be reached. Use the can't-be-reached step.";
  return `Not saved: ${result.reason} Ask that one question again, then save again.`;
}

module.exports = { saveForkmateRequest, saveReply, refusalText };
