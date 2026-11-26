"use strict";

// When a call ends without a summary (they hung up, or the workflow's own
// ending ran), the model reads the transcript once: a short summary, an
// outcome if none was filed, and any listen-for fields still missing.
// Everything it returns is checked; anything that doesn't fit is dropped.

function wrapUpPrompt(lines, cfg, fields) {
  const transcript = lines.map((l) => `${l.who === "agent" ? cfg.voice.name : "Them"}: ${l.text}`).join("\n");
  const wanted = fields.map((f) => `"${f.key}": ${f.description || f.label} (${f.type}), or null`).join(", ");
  return `Below is a phone call between ${cfg.voice.name}, the AI assistant for ${cfg.business}, and ${cfg.direction === "inbound" ? "a caller" : "a person they called"}. The call is over. It may have ended early, part-way through: file it as it stands.

${transcript}

Reply with one JSON object and nothing else, however little was said:
{"outcome": one of ${JSON.stringify(cfg.outcomes)}, "summary": two short factual sentences about who they were and what happened, "data": {${wanted}}}
Use only what was said. If they hung up before anything was settled, the outcome is "other".`;
}

/** The useful parts of the model's reply, or null. Pure. */
function parseWrapUp(reply, cfg, fields) {
  const match = /\{[\s\S]*\}/.exec(String(reply || ""));
  if (!match) return null;
  let raw;
  try {
    raw = JSON.parse(match[0]);
  } catch {
    // Not JSON after all: the call is filed without a summary.
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const data = {};
  for (const f of fields) {
    const v = raw.data && raw.data[f.key];
    if (v !== null && v !== undefined && String(v).trim()) data[f.key] = String(v).trim().slice(0, 500);
  }
  return {
    outcome: cfg.outcomes.includes(raw.outcome) ? raw.outcome : null,
    summary: typeof raw.summary === "string" ? raw.summary.trim().slice(0, 1200) : null,
    data,
  };
}

/** Never throws; null when it can't. */
async function wrapUp({ llmModel, lines, cfg, fields, ChatContext, timeoutMs = 12000, log = console }) {
  try {
    const chatCtx = ChatContext.empty();
    chatCtx.addMessage({ role: "user", content: wrapUpPrompt(lines, cfg, fields) });
    const read = (async () => {
      let reply = "";
      for await (const chunk of llmModel.chat({ chatCtx })) reply += (chunk.delta && chunk.delta.content) || "";
      return reply;
    })();
    const timeout = new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs));
    const reply = await Promise.race([read, timeout]);
    if (reply === null) log.warn(`[WrapUp] no reply in ${timeoutMs} ms`);
    const parsed = parseWrapUp(reply, cfg, fields);
    if (reply && !parsed) log.warn(`[WrapUp] unreadable reply: ${String(reply).slice(0, 200)}`);
    return parsed;
  } catch (err) {
    log.warn(`[WrapUp] failed: ${err.message}`);
    return null;
  }
}

module.exports = { wrapUp, parseWrapUp, wrapUpPrompt };
