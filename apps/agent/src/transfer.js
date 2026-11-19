"use strict";

const { SipClient, RoomServiceClient } = require("livekit-server-sdk");
const { env, TIMING } = require("./config");

// Connecting the owner to the rep: the owner stays in the room, the rep's
// phone is dialled into it, and the owner hears a ring tone until the rep
// picks up. Nothing is hung up and redialled, so the owner is never dropped.

const REP_IDENTITY = "rep";

/** Which outbound trunk carries a call to this number. Pure. */
function trunkFor(phone, trunks) {
  return String(phone).startsWith("+61") && trunks.au ? trunks.au : trunks.standard;
}

/** Ring the rep into the room. Resolves when they pick up; rejects if they don't. */
async function dialRep(roomName, meta) {
  const { url, apiKey, apiSecret } = env.livekit();
  const trunkId = trunkFor(meta.transferNumber, { standard: env.outboundTrunkId(), au: env.outboundTrunkIdAu() });
  return new SipClient(url, apiKey, apiSecret).createSipParticipant(trunkId, meta.transferNumber, roomName, {
    participantIdentity: REP_IDENTITY,
    participantName: meta.repName,
    fromNumber: meta.fromNumber || undefined,
    playDialtone: true,
    ringingTimeout: TIMING.transferRingSec,
    waitUntilAnswered: true,
    krispEnabled: true,
  });
}

/** Hang up everyone by closing the room. A room that is already gone is fine. */
async function closeRoom(roomName, log = console) {
  const { url, apiKey, apiSecret } = env.livekit();
  try {
    await new RoomServiceClient(url, apiKey, apiSecret).deleteRoom(roomName);
  } catch (err) {
    if (!/not.?found/i.test(String(err && err.message))) log.warn(`[Call] could not close the room: ${err.message}`);
  }
}

module.exports = { dialRep, closeRoom, trunkFor, REP_IDENTITY };
