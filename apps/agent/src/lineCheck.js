"use strict";

// Who answered: a person, a voicemail greeting, or a phone menu? The model
// reads the first thing heard on the call and answers with one word. Asked
// this plainly it is reliable; asked to notice it mid-conversation it was not
// (it kept asking a recording whether it was still there).
//
// Unsure means "person": hanging up on a person is the worse mistake.

const KINDS = ["voicemail", "menu", "person"];

function lineCheckPrompt(firstHeard) {
  return `A restaurant's phone was just answered. The first thing heard was:
"${firstHeard}"

Who said it? Answer with exactly one word:
voicemail - a recording asking the caller to leave a message
menu - a recording reading out options to press, or giving opening hours
person - a person who answered and is waiting for a reply (a greeting, however formal, is a person)
If you are not sure, answer person.`;
}

/** The one word out of the model's reply. Anything unclear is a person. Pure. */
function parseLineKind(reply) {
  const said = String(reply || "").toLowerCase();
  const found = KINDS.filter((kind) => new RegExp(`\\b${kind}\\b`).test(said));
  return found.length === 1 ? found[0] : "person";
}

/** Ask the model who answered. Never throws; "person" when it can't tell or can't be reached. */
async function classifyLine({ llmModel, firstHeard, ChatContext, timeoutMs = 6000, log = console }) {
  if (!firstHeard || !String(firstHeard).trim()) return "person";
  try {
    const chatCtx = ChatContext.empty();
    chatCtx.addMessage({ role: "user", content: lineCheckPrompt(String(firstHeard).slice(0, 600)) });
    const read = (async () => {
      let reply = "";
      for await (const chunk of llmModel.chat({ chatCtx })) reply += (chunk.delta && chunk.delta.content) || "";
      return reply;
    })();
    const timeout = new Promise((resolve) => setTimeout(() => resolve(""), timeoutMs));
    return parseLineKind(await Promise.race([read, timeout]));
  } catch (err) {
    log.warn(`[LineCheck] failed: ${err.message}`);
    return "person";
  }
}

module.exports = { classifyLine, parseLineKind, lineCheckPrompt };
