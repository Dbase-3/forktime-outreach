"use strict";

const { llm } = require("@livekit/agents");
const { z } = require("zod");
const { FORKMATE_OCCASIONS, hasCallerNumber } = require("./script");
const { saveForkmateRequest, saveReply } = require("./save");
const { mergeAnswers, nextBookingStep, nextVenueStep, bookingHasNumber } = require("./draft");

/** How a Forkmate call can be filed. Also in AGENT_OUTCOMES (src/outcomes.js). */
const FORKMATE_OUTCOMES = ["forkmate_booking", "forkmate_venue", "not_interested", "wrong_number", "other"];

/** The number to save: the caller's own when they said so, else the one they gave. Pure. */
function chosenNumber(meta, { useCallerNumber, phone }) {
  if (useCallerNumber && hasCallerNumber(meta)) return meta.phone;
  return String(phone || "").trim();
}

/** The booking request as the backend takes it, from what was recorded. Pure. */
function bookingBody(draft, meta) {
  return {
    occasion: draft.occasion,
    location: draft.location,
    guests: draft.guests,
    date: draft.date,
    ...(draft.budget ? { budget: draft.budget } : {}),
    ...(draft.details ? { details: draft.details } : {}),
    name: draft.name,
    phone: chosenNumber(meta, draft),
  };
}

/** The venue as the backend takes it, from what was recorded. Pure. */
function venueBody(draft, meta) {
  return {
    venue: draft.venue,
    location: draft.location,
    capacity: draft.capacity,
    contactName: draft.contactName,
    ...(draft.role ? { role: draft.role } : {}),
    ...(draft.details ? { details: draft.details } : {}),
    phone: chosenNumber(meta, draft),
  };
}

const numberFields = {
  useCallerNumber: z.boolean().optional().describe("True when they said the number they are calling from is the one to use."),
  phone: z.string().max(40).optional().describe("A phone number they gave, digits as heard."),
};

/**
 * The Forkmate call's tools. note_* records what the caller said and answers
 * with the next approved line; save_* sends what was recorded. end_call
 * returns nothing (the goodbye is spoken by the call).
 */
function buildForkmateTools(call, { save = saveForkmateRequest, conn = {} } = {}) {
  const { meta } = call;
  call.forkmateDraft = call.forkmateDraft || {};
  const note = (kind, input) => {
    call.forkmateKind = kind;
    call.forkmateDraft = mergeAnswers(call.forkmateDraft, input);
    return kind === "booking" ? nextBookingStep(call.forkmateDraft, meta) : nextVenueStep(call.forkmateDraft, meta);
  };
  const send = async (kind) => {
    const draft = call.forkmateDraft;
    const open = kind === "booking" ? nextBookingStep(draft, meta) : nextVenueStep(draft, meta);
    if (!/^Everything is in/.test(open)) return `Not saved yet. ${open}`;
    const body = kind === "booking" ? bookingBody(draft, meta) : venueBody(draft, meta);
    const result = await save(kind, { ...body, callId: meta.callId, consent: true }, { ...conn, log: call.log });
    if (result.saved) call.forkmateReference = result.reference;
    call.noteLine?.(result.saved ? `Forkmate ${kind} saved: ${result.reference}` : `Forkmate ${kind} not saved: ${result.reason}`);
    // A refusal about an answer reopens the gathering, so the next note_* asks again.
    if (!result.saved && !result.unreachable) {
      call.forkmateDraft = { ...draft, readBackConfirmed: false, consent: false };
      if (/date/i.test(result.reason)) delete call.forkmateDraft.date;
    }
    return saveReply(result);
  };

  return {
    note_booking: llm.tool({
      description:
        "Record what the caller said about their group booking: everything new in their last words, including details they gave before you asked. " +
        "Fill a field only with something they actually said; leave every other field out, never guess one. " +
        "Answers with the exact next line to say. Call it after every answer while gathering, and say only what it gives you.",
      parameters: z.object({
        occasion: z.enum(FORKMATE_OCCASIONS).optional().describe("The occasion, mapped to one of these. Anything else for a group is Group dining."),
        occasionWords: z.string().max(60).optional().describe("The occasion in their words, for the read-back: \"a birthday\", \"an office Christmas lunch\"."),
        location: z.string().max(120).optional().describe("The suburb or area."),
        guests: z.number().int().min(1).max(10000).optional().describe("How many people are coming, only when they said a number of people. An age (\"60th birthday\") is not a number of guests."),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("The event date as YYYY-MM-DD, on or after today."),
        budget: z.number().int().min(1).optional().describe("Total budget, whole Australian dollars."),
        noBudget: z.boolean().optional().describe("True when they don't know or won't give a budget."),
        details: z.string().max(1000).optional().describe("Dietary needs or anything else they want us to know."),
        noDetails: z.boolean().optional().describe("True when they said no to the dietary / anything-else question."),
        name: z.string().max(100).optional(),
        ...numberFields,
        wantsOtherNumber: z.boolean().optional().describe("True when they said the number they're calling from is not the best one, without giving another."),
        readBackConfirmed: z.boolean().optional().describe("True when they said the read-back is right."),
        consent: z.boolean().optional().describe("True only when they said yes to sharing their details with venues."),
      }),
      execute: async (input) => note("booking", input),
    }),
    note_venue: llm.tool({
      description:
        "Record what the caller said about the venue they want to list: everything new in their last words, including details they gave before you asked. " +
        "Fill a field only with something they actually said; leave every other field out, never guess one. " +
        "Answers with the exact next line to say. Call it after every answer while gathering, and say only what it gives you.",
      parameters: z.object({
        venue: z.string().max(120).optional().describe("The venue's name."),
        location: z.string().max(120).optional().describe("The suburb."),
        capacity: z.number().int().min(1).max(10000).optional().describe("How many guests it seats."),
        contactName: z.string().max(100).optional().describe("The caller's name."),
        role: z.string().max(80).optional().describe("Their role there: owner, manager, chef."),
        noRole: z.boolean().optional().describe("True when they'd rather not say their role."),
        ...numberFields,
        details: z.string().max(1000).optional().describe("What makes the venue special."),
        noDetails: z.boolean().optional().describe("True when they said no to the what-makes-it-special question."),
        consent: z.boolean().optional().describe("True only when they said yes to Forkmate contacting them about joining."),
      }),
      execute: async (input) => note("venue", input),
    }),
    save_booking: llm.tool({
      description: "Save the group booking request that was recorded. Only when note_booking said everything is in.",
      parameters: z.object({}),
      execute: async () => send("booking"),
    }),
    save_venue: llm.tool({
      description: "Save the venue that was recorded. Only when note_venue said everything is in.",
      parameters: z.object({}),
      execute: async () => send("venue"),
    }),
    end_call: llm.tool({
      description:
        "End the call and file it. The goodbye is spoken for you, then the line closes: write nothing else in that reply.",
      parameters: z.object({
        goodbye: z.string().describe("Your last words, word for word from the script when it gives them."),
        outcome: z.enum(FORKMATE_OUTCOMES).describe(
          "forkmate_booking: a booking request was saved. forkmate_venue: a venue was saved. " +
            "not_interested: they didn't want to go on. wrong_number: they meant to call someone else. other: anything else.",
        ),
        summary: z.string().describe("Two short factual sentences: who called and what they wanted. If nothing was saved, every detail they gave."),
        contactName: z.string().optional().describe("The caller's name, if given."),
        restaurantName: z.string().max(160).optional().describe("The venue's name, for a venue listing."),
      }),
      execute: async ({ goodbye, ...filed }) => {
        call.filed = { ...filed, ownerReached: null };
        call.pending = { type: "end", goodbye };
        return undefined;
      },
    }),
  };
}

module.exports = { buildForkmateTools, chosenNumber, bookingBody, venueBody, bookingHasNumber, FORKMATE_OUTCOMES };
