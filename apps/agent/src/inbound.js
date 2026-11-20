"use strict";

// Someone rang the call-back number and the dispatch rule sent them to this
// agent. The room has no call details, so the agent asks the app who this is:
// the app opens the record of the call, says whether we have spoken to this
// number before, and returns everything the call needs.

/** The caller's number and the number they rang, from the phone participant's attributes. Pure. */
function inboundNumbers(participant) {
  const attributes = (participant && participant.attributes) || {};
  const phone = attributes["sip.phoneNumber"] || "";
  const calledNumber = attributes["sip.trunkPhoneNumber"] || "";
  return phone || calledNumber ? { phone, calledNumber } : null;
}

/** Ask the app about an inbound call. Returns { callId, meta } or null when the app can't be reached. */
async function fetchInbound({ baseUrl, key, phone, calledNumber, roomName, fetchImpl = fetch, log = console }) {
  try {
    const response = await fetchImpl(`${baseUrl}/api/agent/inbound`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-agent-key": key },
      // A caller with a hidden number has none to send: the app takes the call as a new one.
      body: JSON.stringify({ phone: phone || "unknown", calledNumber, roomName }),
    });
    if (!response.ok) {
      log.warn(`[Inbound] the app refused the call (${response.status})`);
      return null;
    }
    const data = await response.json();
    return data && data.callId && data.meta ? data : null;
  } catch (err) {
    log.warn(`[Inbound] could not reach the app: ${err.message}`);
    return null;
  }
}

module.exports = { inboundNumbers, fetchInbound };
