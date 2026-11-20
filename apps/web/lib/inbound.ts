import { randomUUID } from "node:crypto";
import { collections } from "./db";
import { callMetadata } from "./dialer";
import { buildCallbackWelcome } from "./opening-line";
import { getSettings } from "./settings";
import type { Call, Settings } from "./types";

// An owner (or anyone) ringing the call-back number. The agent asks the app
// who this is: if we have spoken to the number before, it carries on from
// what was noted; either way it opens differently from an outbound call.

const yes = (v: boolean | null) => (v == null ? null : v ? "yes" : "no");

/** What was noted on an earlier call, as one paragraph for the agent. Pure. */
export function previousNoteOf(call: Pick<Call, "summary" | "takesLargeBookings" | "seats" | "capacityNote" | "vegetarianVegan" | "interestedInSystem" | "callbackTime" | "contactName" | "ownerReached" | "label" | "endedAt">): string {
  const parts: string[] = [];
  if (call.label) parts.push(`the restaurant is ${call.label}`);
  if (call.contactName) parts.push(`you spoke to ${call.contactName}`);
  if (call.ownerReached != null) parts.push(call.ownerReached ? "you reached the owner or manager" : "you only reached staff");
  if (call.takesLargeBookings != null) parts.push(`takes large bookings: ${yes(call.takesLargeBookings)}`);
  if (call.seats != null) parts.push(`seats: ${call.seats}`);
  else if (call.capacityNote) parts.push(`capacity: ${call.capacityNote}`);
  if (call.vegetarianVegan) parts.push(`vegetarian/vegan: ${call.vegetarianVegan}`);
  if (call.interestedInSystem != null) parts.push(`wants to hear about the AI phone assistant: ${yes(call.interestedInSystem)}`);
  if (call.callbackTime) parts.push(`the owner is free: ${call.callbackTime}`);
  if (call.summary) parts.push(`summary: ${call.summary}`);
  return parts.join("; ");
}

/**
 * Open the record of an inbound call and say how the agent should take it.
 * An inbound call never takes the dialling line, so it never blocks the queue.
 */
export async function startInboundCall(input: { phone: string; calledNumber: string; roomName: string }, now = new Date()) {
  const { calls } = await collections();
  const settings = await getSettings();
  const previous = await calls.find({ phone: input.phone, status: "ended" }).sort({ endedAt: -1 }).limit(1).next();
  const last = await calls.find({}, { projection: { order: 1 } }).sort({ order: -1 }).limit(1).next();

  const call: Call = {
    _id: randomUUID(),
    batchId: randomUUID(),
    phone: input.phone,
    label: previous?.label ?? "",
    status: "live",
    stage: "talking",
    outcome: null,
    attempt: 1,
    order: (last?.order ?? 0) + 1,
    fromNumber: input.calledNumber,
    roomName: input.roomName,
    notBefore: null,
    queuedAt: now,
    startedAt: now,
    answeredAt: now,
    endedAt: null,
    durationSec: null,
    summary: null,
    ownerReached: null,
    contactName: null,
    callbackTime: null,
    bookingSystem: null,
    interested: null,
    takesLargeBookings: null,
    seats: null,
    capacityNote: null,
    vegetarianVegan: null,
    interestedInSystem: null,
    direction: "inbound",
    recording: null,
    error: null,
    simulated: false,
  };
  await calls.insertOne(call);

  const meta = {
    ...callMetadata(call, settings),
    openingLine: buildCallbackWelcome(settings, !!previous),
    previousNote: previous ? previousNoteOf(previous) : null,
  };
  return { callId: call._id, meta };
}
