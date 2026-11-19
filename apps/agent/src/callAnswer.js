"use strict";

// Waiting for an outbound call to be picked up. LiveKit marks the dialled
// phone's participant with `sip.callStatus`: dialing, ringing, active, hangup.
// "active" is the pickup. A line still ringing when time runs out was not
// answered, so nobody greets an empty line.

/** The call status LiveKit put on a participant, or null. Pure. */
function sipCallStatus(participant) {
  const value = participant && participant.attributes && participant.attributes["sip.callStatus"];
  return typeof value === "string" && value ? value : null;
}

/** What the participants say about the call: "answered", "hangup" or null. Pure. */
function callAnswerState(participants) {
  for (const participant of participants) {
    const status = sipCallStatus(participant);
    if (status === "active") return "answered";
    if (status === "hangup") return "hangup";
  }
  return null;
}

/** @returns {Promise<"answered" | "not_answered">} */
function waitForCallAnswer(room, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;

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
      const state = callAnswerState(room.remoteParticipants.values());
      if (state === "answered") finish("answered");
      else if (state === "hangup") finish("not_answered");
    }
    function onLeft() {
      if (room.remoteParticipants.size === 0) finish("not_answered");
    }

    room.on("participantAttributesChanged", check);
    room.on("participantConnected", check);
    room.on("participantDisconnected", onLeft);
    timer = setTimeout(() => finish(callAnswerState(room.remoteParticipants.values()) === "answered" ? "answered" : "not_answered"), timeoutMs);
    check();
  });
}

module.exports = { sipCallStatus, callAnswerState, waitForCallAnswer };
