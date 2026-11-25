"use strict";

// What the caller has told us so far, and the next question to ask. The model
// records each answer with note_booking / note_venue; this decides, from those
// recorded fields only, which approved line comes next, so the order and the
// skipping never depend on the model remembering. All pure.

const { LINES, hasCallerNumber } = require("./script");

/** Keep what the model recorded on top of what we had; empty values never erase an answer. */
function mergeAnswers(draft, input) {
  const next = { ...draft };
  for (const [key, value] of Object.entries(input || {})) {
    if (value === undefined || value === null || value === "") continue;
    next[key] = typeof value === "string" ? value.trim() : value;
  }
  // A number they gave replaces "use the one I'm calling from", and the other way round.
  if (input && input.phone) delete next.useCallerNumber;
  if (input && input.useCallerNumber) delete next.phone;
  return next;
}

const ORDINALS = { 1: "st", 2: "nd", 3: "rd", 21: "st", 22: "nd", 23: "rd", 31: "st" };

/** 2026-12-05 → "Saturday the 5th of December" (a calendar day; no clock involved). */
function spokenDate(iso) {
  const [y, m, d] = String(iso || "").split("-").map(Number);
  if (!y || !m || !d) return String(iso || "");
  const at = new Date(Date.UTC(y, m - 1, d));
  const weekday = new Intl.DateTimeFormat("en-AU", { weekday: "long", timeZone: "UTC" }).format(at);
  const month = new Intl.DateTimeFormat("en-AU", { month: "long", timeZone: "UTC" }).format(at);
  return `${weekday} the ${d}${ORDINALS[d] || "th"} of ${month}`;
}

/** The read-back, in the approved shape: "That's a birthday for 30 on Saturday the 5th of December in New Farm, around 1,500 dollars. Is that right?" */
function bookingReadBack(draft) {
  const what = draft.occasionWords || `a ${String(draft.occasion || "booking").toLowerCase()}`;
  const budget = draft.budget ? `, around ${Math.round(draft.budget).toLocaleString("en-AU")} dollars` : "";
  return `That's ${what} for ${draft.guests} on ${spokenDate(draft.date)} in ${draft.location}${budget}. Is that right?`;
}

const ask = (line) => `Ask, word for word: "${line}"`;

/** Whether a booking has a number we can save. */
function bookingHasNumber(draft, meta) {
  return Boolean(draft.phone) || (draft.useCallerNumber === true && hasCallerNumber(meta));
}

/** The next thing to say on a booking call, from what has been recorded. */
function nextBookingStep(draft, meta) {
  const B = LINES.booking;
  if (!draft.occasion) return ask(B[0]);
  if (!draft.location) return ask(B[1]);
  if (!draft.guests) return ask(B[2]);
  if (!draft.date) return ask(B[3]);
  if (!draft.budget && !draft.noBudget) return ask(B[4]);
  if (!draft.details && !draft.noDetails) return ask(B[5]);
  if (!draft.name) return ask(B[6]);
  if (!bookingHasNumber(draft, meta)) {
    // Hidden caller, or they said this isn't the number: ask for one.
    return ask(hasCallerNumber(meta) && !draft.wantsOtherNumber ? B[7] : LINES.bookingOtherNumber);
  }
  if (!draft.readBackConfirmed) return `Read it back, word for word: "${bookingReadBack(draft)}"`;
  if (!draft.consent) return ask(LINES.bookingConsent);
  return "Everything is in. Call save_booking now.";
}

/** The next thing to say on a venue call, from what has been recorded. */
function nextVenueStep(draft, meta) {
  const V = LINES.venue;
  if (!draft.venue) return ask(V[0]);
  if (!draft.location) return ask(V[1]);
  if (!draft.capacity) return ask(V[2]);
  if (!draft.contactName) return ask(V[3]);
  if (!draft.role && !draft.noRole) return ask(V[4]);
  if (!draft.phone && !(draft.useCallerNumber === true && hasCallerNumber(meta))) return ask(V[5]);
  if (!draft.details && !draft.noDetails) return ask(V[6]);
  if (!draft.consent) return ask(LINES.venueConsent);
  return "Everything is in. Call save_venue now.";
}

module.exports = { mergeAnswers, spokenDate, bookingReadBack, nextBookingStep, nextVenueStep, bookingHasNumber };
