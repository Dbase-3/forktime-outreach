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
];

module.exports = { AGENT_OUTCOMES };
