"use strict";

// Phone calls from the Lisna line (owner 2026-11-28). The API rings the phone
// into the room as participant "phone" (named in the room's metadata) and
// returns at once; LiveKit marks that participant with `sip.callStatus`:
// dialing, ringing, active, hangup. "active" is the pickup. Others in the room
// (the owner listening in from the browser) are ignored. Adapted from
// apps/agent/src/callAnswer.js (the outreach agent's), keyed to one identity.

/** The phone's participant identity from a dispatch or room metadata, or null (not a phone call). Pure. */
function phoneIdentityFrom(raw) {
  try {
    const meta = JSON.parse(raw || "");
    return meta && typeof meta.phone === "string" && /^[\w-]{1,40}$/.test(meta.phone) ? meta.phone : null;
  } catch {
    return null;
  }
}

/** The call status LiveKit put on a participant, or null. Pure. */
function sipCallStatus(participant) {
  const value = participant && participant.attributes && participant.attributes["sip.callStatus"];
  return typeof value === "string" && value ? value : null;
}

/**
 * Wait until the phone `identity` picks up. "not_answered" when it hangs up,
 * leaves, or is still ringing after `timeoutMs`, so nobody greets an empty line.
 * @returns {Promise<"answered" | "not_answered">}
 */
function waitForPickup(room, identity, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    const phone = () => room.remoteParticipants.get(identity) || [...room.remoteParticipants.values()].find((p) => p.identity === identity);
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      room.off("participantAttributesChanged", check);
      room.off("participantConnected", check);
      room.off("participantDisconnected", onLeft);
      resolve(result);
    };
    function check() {
      const status = sipCallStatus(phone());
      if (status === "active") finish("answered");
      else if (status === "hangup") finish("not_answered");
    }
    function onLeft(p) {
      if (p && p.identity === identity) finish("not_answered");
    }
    room.on("participantAttributesChanged", check);
    room.on("participantConnected", check);
    room.on("participantDisconnected", onLeft);
    timer = setTimeout(() => finish(sipCallStatus(phone()) === "active" ? "answered" : "not_answered"), timeoutMs);
    check();
  });
}

module.exports = { phoneIdentityFrom, sipCallStatus, waitForPickup };
