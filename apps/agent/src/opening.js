"use strict";

// The first thing the person who picks up hears. It must say that this is an
// AI and name the company; the app builds it (apps/web/lib/opening-line.ts)
// and this file refuses a line that leaves either out.

function firstName(fullName) {
  return String(fullName || "").trim().split(/\s+/)[0] || "";
}

/** Whether a line says it is an AI and names the person it calls for (first name). Mirrors the app's check. */
function hasDisclosure(line, repFirstName) {
  const said = String(line || "").toLowerCase();
  const who = String(repFirstName || "").trim().toLowerCase();
  return /\bai\b/.test(said) && who.length > 0 && said.includes(who);
}

/** The agent's own opening line, used when the one it was handed fails the check. */
function builtInOpeningLine(meta) {
  const notice = meta.recordCalls ? " This call is recorded." : "";
  return `Hi, this is ${meta.agentName}, an AI assistant calling on behalf of ${firstName(meta.repName)}.${notice} Is the owner or manager around?`;
}

/** The line to speak: the one from the app when it discloses, else the built-in one. */
function resolveOpeningLine(meta) {
  const handed = String(meta.openingLine || "").trim();
  return hasDisclosure(handed, firstName(meta.repName)) ? handed : builtInOpeningLine(meta);
}

module.exports = { firstName, hasDisclosure, builtInOpeningLine, resolveOpeningLine };
