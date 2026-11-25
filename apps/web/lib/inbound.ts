import { randomUUID } from "node:crypto";
import { collections } from "./db";
import { callMetadata } from "./dialer";
import { buildCallbackWelcome } from "./opening-line";
import { getSettings } from "./settings";
import type { Call, Settings } from "./types";
import { DEFAULT_WORKSPACE_ID, workspaceFilter } from "./workspaces";

// Someone ringing one of our numbers. The agent asks the app who this is.
// A number we have rung before is a restaurant calling Sara back: it carries
// on from what was noted (Sara's script). Anyone else reaches the Forkmate
// line (owner, 2026-11-25): a group booking request or a venue that wants to
// join, saved through the Forktime API. The agent holds the Forkmate wording.

const yes = (v: boolean | null) => (v == null ? null : v ? "yes" : "no");

/** What was noted on an earlier call, as one paragraph for the agent. Pure. */
export function previousNoteOf(call: Pick<Call,
  "summary" | "takesLargeBookings" | "takesCatering" | "seats" | "capacityNote" | "vegetarianVegan" | "dietaryOptions" |
  "interestedInBookingInquiries" | "interestedInSystem" | "callbackNumber" | "callbackTime" | "callbackPermission" |
  "contactName" | "ownerReached" | "label" | "endedAt"
>): string {
  const parts: string[] = [];
  if (call.label) parts.push(`the restaurant is ${call.label}`);
  if (call.contactName) parts.push(`owner or manager name recorded: ${call.contactName}`);
  if (call.ownerReached != null) parts.push(call.ownerReached ? "you reached the owner or manager" : "you only reached staff");
  if (call.takesLargeBookings != null) parts.push(`takes large bookings: ${yes(call.takesLargeBookings)}`);
  if (call.takesCatering != null) parts.push(`handles catering: ${yes(call.takesCatering)}`);
  if (call.seats != null) parts.push(`seats: ${call.seats}`);
  else if (call.capacityNote) parts.push(`capacity: ${call.capacityNote}`);
  const dietaryOptions = call.dietaryOptions || call.vegetarianVegan;
  if (dietaryOptions) parts.push(`dietary accommodations: ${dietaryOptions}`);
  if (call.interestedInBookingInquiries != null) parts.push(`wants more reservation or catering inquiries: ${yes(call.interestedInBookingInquiries)}`);
  if (call.interestedInSystem != null) parts.push(`wants to hear about the AI phone assistant: ${yes(call.interestedInSystem)}`);
  if (call.callbackTime) parts.push(`the owner is free: ${call.callbackTime}`);
  if (call.callbackNumber) parts.push(`best callback number: ${call.callbackNumber}`);
  if (call.callbackPermission != null) parts.push(`owner agreed to a team callback: ${yes(call.callbackPermission)}`);
  if (call.summary) parts.push(`summary: ${call.summary}`);
  return parts.join("; ");
}

/**
 * Open the record of an inbound call and say how the agent should take it.
 * An inbound call never takes the dialling line, so it never blocks the queue.
 */
export async function startInboundCall(
  input: { phone: string; calledNumber: string; roomName: string; workspaceId?: string },
  now = new Date(),
) {
  const { calls } = await collections();
  const workspaceId = input.workspaceId ?? DEFAULT_WORKSPACE_ID;
  const settings = await getSettings(workspaceId);
  // Only a number we actually dialled makes this a call-back; an earlier Forkmate call doesn't.
  // A missed call is queued again with startedAt cleared and the attempt counted, hence the $or.
  const rangBefore = await calls.findOne({
    $and: [
      workspaceFilter(workspaceId),
      { phone: input.phone, direction: { $ne: "inbound" } },
      { $or: [{ startedAt: { $ne: null } }, { attempt: { $gt: 1 } }, { status: "ended" }] },
    ],
  });
  const mode: "callback" | "forkmate" = rangBefore ? "callback" : "forkmate";
  const previous =
    mode === "callback"
      ? await calls.find({ $and: [workspaceFilter(workspaceId), { phone: input.phone, status: "ended" }] }).sort({ endedAt: -1 }).limit(1).next()
      : null;
  const last = await calls.find(workspaceFilter(workspaceId), { projection: { order: 1 } }).sort({ order: -1 }).limit(1).next();

  const call: Call = {
    _id: randomUUID(),
    workspaceId,
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
    inboundMode: mode,
    recording: null,
    error: null,
    simulated: false,
  };
  await calls.insertOne(call);

  const meta = {
    ...callMetadata(call, settings),
    mode,
    // The Forkmate greeting is the agent's (apps/agent/src/forkmate/script.js).
    openingLine: mode === "forkmate" ? "" : buildCallbackWelcome(settings, !!previous),
    previousNote: previous ? previousNoteOf(previous) : null,
  };
  return { callId: call._id, meta };
}
