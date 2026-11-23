"use strict";

const { AGENT_OUTCOMES } = require("./outcomes");

// When a call ends without the agent filing it (the other side hung up
// mid-sentence), the model reads the transcript once and files it. What it
// returns is checked field by field; anything that does not fit is dropped.

function wrapUpPrompt(lines, meta) {
  const speaker = (role) => (role === "agent" ? meta.agentName : role === "system" ? "(Call note)" : "Them");
  const transcript = lines.map((l) => `${speaker(l.role)}: ${l.text}`).join("\n");
  return `Below is the transcript of a restaurant outreach call involving ${meta.agentName}, an AI assistant from ${meta.company}. The call ended before it was filed.

${transcript}

Reply with one JSON object and nothing else:
{"outcome": one of ${JSON.stringify(AGENT_OUTCOMES)}, "summary": two short factual sentences, "ownerReached": true or false, "restaurantName": string or null, "contactName": string or null, "callbackNumber": string or null, "callbackTime": string or null, "callbackPermission": true, false or null, "takesLargeBookings": true, false or null, "takesCatering": true, false or null, "seats": whole number or null, "dietaryOptions": string or null, "bookingSystem": string or null, "interestedInBookingInquiries": true, false or null, "interestedInSystem": true, false or null, "interested": true, false or null}
Use only what was said. Use ${JSON.stringify(meta.phone || "")} as the callback number if they confirmed "this number". An incomplete direct number should be left unset. Keep the agreed date and time in their words. A callback request is a note for the team, so describe what was requested rather than saying a call was scheduled. A generic yes to a choice of two services or two booking capabilities does not confirm each one separately. Only set callbackPermission true and use owner_callback if the owner or manager explicitly agreed to a callback, including a callback because they were busy. Interest in a service or a general acknowledgment is insufficient. Lines marked (Call note) are facts about the call: if one says they were connected to ${meta.repName}, the summary says so. If they hung up before anything was agreed, the outcome is "other".`;
}

const text = (value, max) => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null);
const flag = (value) => (typeof value === "boolean" ? value : null);

/** The fields of a filed call out of the model's reply, or null when it is not usable. Pure. */
function parseWrapUp(reply) {
  const match = /\{[\s\S]*\}/.exec(String(reply || ""));
  if (!match) return null;
  let data;
  try {
    data = JSON.parse(match[0]);
  } catch {
    // Not JSON after all: the call is filed without a summary.
    return null;
  }
  if (!data || typeof data !== "object") return null;
  return {
    outcome: AGENT_OUTCOMES.includes(data.outcome) ? data.outcome : null,
    summary: text(data.summary, 1200),
    ownerReached: flag(data.ownerReached),
    restaurantName: text(data.restaurantName, 160),
    contactName: text(data.contactName, 120),
    callbackNumber: text(data.callbackNumber, 80),
    callbackTime: text(data.callbackTime, 160),
    callbackPermission: flag(data.callbackPermission),
    takesLargeBookings: flag(data.takesLargeBookings),
    takesCatering: flag(data.takesCatering),
    seats: Number.isInteger(data.seats) && data.seats >= 0 ? data.seats : null,
    dietaryOptions: text(data.dietaryOptions, 200),
    bookingSystem: text(data.bookingSystem, 120),
    interestedInBookingInquiries: flag(data.interestedInBookingInquiries),
    interestedInSystem: flag(data.interestedInSystem),
    interested: flag(data.interested),
  };
}

/** Ask the model to file a call from its transcript. Never throws; null when it can't. */
async function wrapUp({ llmModel, lines, meta, ChatContext, timeoutMs = 12000, log = console }) {
  if (!lines.some((l) => l.role === "callee")) return null;
  try {
    const chatCtx = ChatContext.empty();
    chatCtx.addMessage({ role: "user", content: wrapUpPrompt(lines, meta) });
    const read = (async () => {
      let reply = "";
      for await (const chunk of llmModel.chat({ chatCtx })) reply += (chunk.delta && chunk.delta.content) || "";
      return reply;
    })();
    const timeout = new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs));
    return parseWrapUp(await Promise.race([read, timeout]));
  } catch (err) {
    log.warn(`[WrapUp] failed: ${err.message}`);
    return null;
  }
}

module.exports = { wrapUp, parseWrapUp, wrapUpPrompt };
