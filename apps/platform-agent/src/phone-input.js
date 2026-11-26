"use strict";

// From the outreach agent (apps/agent/src/phone-input.js), widened for any
// owner's wording: when the agent has just asked for a phone number, the call
// waits longer at pauses and joins the pieces of a number read out in groups.

/** The agent's line asks for a phone number. */
function asksForPhoneNumber(text) {
  return /\?/.test(text) && /\b(?:best (?:phone |contact )?number|direct (?:business |phone )?number|callback (?:phone )?number|(?:what|which) (?:phone |mobile |contact )?number|(?:your|a) (?:phone|mobile|cell|contact|callback) number|number (?:to|we can) (?:reach|call))\b/i.test(text);
}

/** Soniox can deliver a country's dialing code or a short group as its own turn. */
function isIncompletePhoneReply(text) {
  const digits = /\d+|\b(?:oh|zero|one|two|three|four|five|six|seven|eight|nine)\b/gi;
  const groups = text.match(digits) || [];
  const count = groups.reduce((sum, group) => sum + (/^\d/.test(group) ? group.length : 1), 0);
  const remainder = text.replace(digits, " ").replace(/[^a-z\s]/gi, " ").replace(/\s+/g, " ").trim();
  return count < 8 && /^(?:(?:uh|um|hmm|well|okay|and|the|my|our|his|her|their|direct|business|phone|mobile|number|is|it|its|s|like|starts|with|plus|double|triple)(?: |$))*$/i.test(remainder);
}

module.exports = { asksForPhoneNumber, isIncompletePhoneReply };
