"use strict";

// How the agent can file a call with its end_call tool. apps/web/lib/outcomes.ts
// holds the same list (AGENT_OUTCOMES) and a test there fails if they drift.

const AGENT_OUTCOMES = [
  "owner_callback",
  "not_interested",
  "message_left",
  "call_back_later",
  "refused",
  "not_a_fit",
  "voicemail",
  "phone_menu",
  "wrong_number",
  "do_not_call",
  "other",
  // The Forkmate line (inbound callers we never rang): src/forkmate/tools.js.
  "forkmate_booking",
  "forkmate_venue",
];

function filedOutcome({ outcome, ownerReached, callbackPermission }) {
  if (outcome === "not_interested" && ownerReached === false) return "refused";
  if (outcome !== "owner_callback" && outcome !== "call_back_later") return outcome || null;
  if (ownerReached === false) return "call_back_later";
  if (ownerReached === true && callbackPermission === true) return "owner_callback";
  return "other";
}

module.exports = { AGENT_OUTCOMES, filedOutcome };
