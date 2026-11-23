import { AgentDispatchClient, RoomServiceClient, SipClient } from "livekit-server-sdk";
import { env } from "./env";
import { buildOpeningLine } from "./opening-line";
import { spokenPhone } from "./phone";
import type { Call, Settings } from "./types";

// Places one real call: a LiveKit room that carries the call's details, the
// voice agent dispatched into it by name, then the restaurant's number dialled
// on the outbound trunk. The agent waits in the room for the pickup.

/** The identity the dialled phone has in the room; the agent listens to this one only. */
export const CALLEE_IDENTITY = "callee";

export function roomNameFor(call: Pick<Call, "_id" | "attempt">): string {
  return `outreach-${call._id}-${call.attempt}`;
}

/** Which outbound trunk carries a call to this number. Pure. */
export function trunkFor(phone: string, trunks: { standard: string; au: string }): string {
  return phone.startsWith("+61") && trunks.au ? trunks.au : trunks.standard;
}

/** Everything the agent needs for one call. It rides in the room and the dispatch. */
export function callMetadata(call: Call, settings: Settings) {
  return {
    kind: "outreach" as const,
    callId: call._id,
    attempt: call.attempt,
    direction: call.direction,
    phone: call.phone,
    label: call.label,
    fromNumber: call.fromNumber,
    openingLine: buildOpeningLine(settings),
    agentName: settings.agentName,
    repName: settings.repName,
    company: settings.company,
    topic: settings.topic,
    transferNumber: call.direction === "inbound" ? settings.transferNumber : "",
    callbackNumber: settings.callbackNumber,
    /** The call-back number as words, so the voice reads it digit by digit. */
    callbackNumberSpoken: settings.callbackNumber ? spokenPhone(settings.callbackNumber) : "",
    voiceProvider: settings.voiceProvider,
    voiceId: settings.voiceId,
    voiceSpeed: settings.voiceSpeed,
    ringTimeoutSec: settings.ringTimeoutSec,
    maxCallMinutes: settings.maxCallMinutes,
    recordCalls: settings.recordCalls,
    recordingNotice: settings.recordingNotice,
  };
}

export type CallMetadata = ReturnType<typeof callMetadata>;

export async function placeCall(call: Call, settings: Settings, roomName: string): Promise<void> {
  const { url, apiKey, apiSecret } = env.livekit();
  const trunkId = trunkFor(call.phone, { standard: env.outboundTrunkId(), au: env.outboundTrunkIdAu() });
  const metadata = JSON.stringify(callMetadata(call, settings));

  await new RoomServiceClient(url, apiKey, apiSecret).createRoom({
    name: roomName,
    metadata,
    emptyTimeout: 60,
    maxParticipants: 4,
  });
  await new AgentDispatchClient(url, apiKey, apiSecret).createDispatch(roomName, env.agentName(), { metadata });
  // Not waiting for the answer here: the agent reports the pickup, a ring-out
  // or a refusal, so this request returns at once.
  await new SipClient(url, apiKey, apiSecret).createSipParticipant(trunkId, call.phone, roomName, {
    participantIdentity: CALLEE_IDENTITY,
    participantName: call.label || "Callee",
    fromNumber: call.fromNumber || undefined,
    ringingTimeout: settings.ringTimeoutSec,
    waitUntilAnswered: false,
    krispEnabled: true,
  });
}

/** Hang up a call by closing its room. A room that is already gone is fine. */
export async function closeRoom(roomName: string): Promise<void> {
  const { url, apiKey, apiSecret } = env.livekit();
  try {
    await new RoomServiceClient(url, apiKey, apiSecret).deleteRoom(roomName);
  } catch (err) {
    if (!/not.?found/i.test(String((err as Error)?.message ?? ""))) throw err;
  }
}
