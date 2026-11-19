"use strict";

const { AGENT_OUTCOMES } = require("./outcomes");

// When a call ends without the agent filing it (the other side hung up
// mid-sentence), the model reads the transcript once and files it. What it
// returns is checked field by field; anything that does not fit is dropped.

function wrapUpPrompt(lines, meta) {
  const speaker = (role) => (role === "agent" ? meta.agentName : role === "system" ? "(Call note)" : "Them");
  const transcript = lines.map((l) => `${speaker(l.role)}: ${l.text}`).join("\n");
  return `Below is the transcript of a phone call. ${meta.agentName} is an AI assistant that called a restaurant for ${meta.repName} at ${meta.company}, asking for the owner. The call ended before it was filed.

${transcript}

Reply with one JSON object and nothing else:
{"outcome": one of ${JSON.stringify(AGENT_OUTCOMES)}, "summary": two short factual sentences, "ownerReached": true or false, "contactName": string or null, "callbackTime": string or null, "bookingSystem": string or null, "interested": true, false or null}
Use only what was said. Lines marked (Call note) are facts about the call: if one says they were connected to ${meta.repName}, the summary says so. If they hung up before anything was agreed, the outcome is "other".`;
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
    contactName: text(data.contactName, 120),
    callbackTime: text(data.callbackTime, 160),
    bookingSystem: text(data.bookingSystem, 120),
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
