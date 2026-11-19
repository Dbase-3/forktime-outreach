"use strict";

const { EgressClient } = require("livekit-server-sdk");
const { env } = require("./config");

// Records the call's audio through LiveKit Egress into the S3-compatible
// bucket set in the environment (the same way the Forktime phone agent
// records). With no bucket set, calls simply are not recorded.

function recordingPath(meta) {
  return `outreach/${meta.callId}-${meta.attempt}.ogg`;
}

function recordingConfigured() {
  const r = env.recording();
  return !!(r.bucket && r.accessKey && r.secret);
}

/** Start recording a room. Returns the id to stop it with, or null when recording is off or failed. */
async function startRecording(roomName, meta, log = console) {
  if (!meta.recordCalls || !recordingConfigured()) return null;
  const { url, apiKey, apiSecret } = env.livekit();
  const storage = env.recording();
  try {
    const client = new EgressClient(url, apiKey, apiSecret);
    const headers = await client.authHeader({ roomRecord: true });
    const started = await client.rpc.request(
      "Egress",
      "StartRoomCompositeEgress",
      {
        roomName,
        audioOnly: true,
        file: {
          fileType: "OGG",
          filepath: recordingPath(meta),
          s3: {
            accessKey: storage.accessKey,
            secret: storage.secret,
            bucket: storage.bucket,
            region: storage.region,
            endpoint: storage.endpoint || undefined,
            forcePathStyle: true,
          },
        },
      },
      headers,
    );
    return started.egressId || null;
  } catch (err) {
    log.warn(`[Recording] could not start: ${err.message}`);
    return null;
  }
}

/** Stop a recording. Returns where the file is and how long it runs, or null. */
async function stopRecording(egressId, meta, log = console) {
  if (!egressId) return null;
  const { url, apiKey, apiSecret } = env.livekit();
  const storage = env.recording();
  try {
    const client = new EgressClient(url, apiKey, apiSecret);
    const headers = await client.authHeader({ roomRecord: true });
    const stopped = await client.rpc.request("Egress", "StopEgress", { egressId }, headers);
    const file = stopped.fileResults && stopped.fileResults[0];
    const filename = (file && file.filename) || recordingPath(meta);
    const durationNs = file && file.duration ? Number(file.duration) : null;
    return {
      url: storage.publicUrl ? `${storage.publicUrl}/${filename}` : (file && file.location) || null,
      // Egress reports the length in nanoseconds.
      durationSec: durationNs ? Math.round(durationNs / 1e9) : null,
    };
  } catch (err) {
    log.warn(`[Recording] could not stop: ${err.message}`);
    return null;
  }
}

module.exports = { startRecording, stopRecording, recordingPath, recordingConfigured };
