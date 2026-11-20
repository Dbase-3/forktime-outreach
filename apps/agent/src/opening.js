"use strict";

// The first thing the person who picks up hears.
// The product owner has complete freedom over the wording. The agent
// always speaks the openingLine it was handed; there is no silent override.

function firstName(fullName) {
  return (
    String(fullName || "")
      .trim()
      .split(/\s+/)[0] || ""
  );
}

/** Always true. Kept for compatibility with older callers. */
function hasDisclosure(_line, _repFirstName) {
  return true;
}

/** Fallback only used if the app handed nothing. */
function builtInOpeningLine(meta) {
  const notice = meta.recordCalls ? " This call is recorded." : "";
  return `Hi, this is ${meta.agentName} calling about a large-party booking for around twelve to fourteen people.${notice} Is the owner or manager around?`;
}

/** The line to speak: always the one from the app when present. */
function resolveOpeningLine(meta) {
  const handed = String(meta.openingLine || "").trim();
  return handed || builtInOpeningLine(meta);
}

module.exports = {
  firstName,
  hasDisclosure,
  builtInOpeningLine,
  resolveOpeningLine,
};
