"use strict";

/**
 * One real test call end to end, with a scripted caller instead of a person:
 * signs in to the local API, starts a test call on an agent, joins the room,
 * and speaks each reply (made with macOS `say`) once the agent has finished
 * its turn. Then prints the call as the API filed it, with reply times.
 *
 *   node scripts/test-call.js [--agent "service check"] [--say "Yes"]...
 *
 * Needs the API (with DEV_LOGIN_CODE) and the platform agent running locally.
 * Spends a little on the eval key, ElevenLabs and Soniox.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
require("dotenv").config({ path: path.join(__dirname, "..", "..", "api", ".env") });
const { AudioFrame, AudioSource, AudioStream, LocalAudioTrack, Room, RoomEvent, TrackKind, TrackSource } = require("@livekit/rtc-node");

const API = process.env.PLATFORM_API_URL || "http://localhost:4300";
const EMAIL = process.env.TEST_CALL_EMAIL || "voice-test@example.com";
const RATE = 16000;

function args() {
  const out = { agent: "service check", say: [] };
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--agent") out.agent = a[++i];
    else if (a[i] === "--say") out.say.push(a[++i]);
  }
  if (!out.say.length) out.say = ["Yeah sure, I've got a minute.", "Yes, it's running really well, thanks.", "Yes please, book me in."];
  return out;
}

let cookie = "";
async function api(method, p, body) {
  const res = await fetch(`${API}${p}`, { method, headers: { "content-type": "application/json", cookie }, body: body ? JSON.stringify(body) : undefined });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${p}: ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

/** 16 kHz mono PCM for a line, spoken by macOS. */
function speech(text, dir) {
  const file = path.join(dir, `line-${Date.now()}.wav`);
  execFileSync("say", ["-v", "Samantha", "-o", file, "--file-format=WAVE", "--data-format=LEI16@16000", text]);
  const buf = fs.readFileSync(file);
  let at = 12;
  while (at < buf.length - 8) {
    const id = buf.toString("ascii", at, at + 4);
    const size = buf.readUInt32LE(at + 4);
    if (id === "data") return new Int16Array(buf.buffer.slice(buf.byteOffset + at + 8, buf.byteOffset + at + 8 + size));
    at += 8 + size;
  }
  throw new Error("no audio data");
}

async function play(source, pcm) {
  const step = RATE / 100; // 10 ms frames
  for (let i = 0; i < pcm.length; i += step) {
    const chunk = new Int16Array(step);
    chunk.set(pcm.subarray(i, i + step));
    await source.captureFrame(new AudioFrame(chunk, RATE, 1, step));
  }
}
const silence = (ms) => new Int16Array((RATE * ms) / 1000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { agent: wanted, say } = args();
  const code = process.env.DEV_LOGIN_CODE;
  if (!code) throw new Error("DEV_LOGIN_CODE isn't set in apps/api/.env");
  await api("POST", "/auth/verify", { email: EMAIL, code });
  let spaces = (await api("GET", "/me")).workspaces;
  if (!spaces.length) spaces = [await api("POST", "/workspaces", { name: "Northside Motors", timezone: "Australia/Sydney", sample: true })];
  const ws = `/w/${spaces[0].id}`;
  const agents = await api("GET", `${ws}/agents`);
  const agent = agents.find((a) => a.name.toLowerCase().includes(wanted.toLowerCase())) || agents[0];
  const contact = (await api("POST", `${ws}/contacts/query`, { pageSize: 1 })).rows[0];
  console.log(`Calling as ${contact ? contact.name : "nobody"} → ${agent.name}`);
  const started = await api("POST", `${ws}/agents/${agent.id}/test-call`, { contactId: contact ? contact.id : null });

  const room = new Room();
  let state = "initializing";
  let spokeAt = 0;
  let quietAt = 0;
  const replyTimes = [];
  let waitingSince = 0;
  room.on(RoomEvent.ParticipantAttributesChanged, (changed, p) => {
    const next = p.attributes && p.attributes["lk.agent.state"];
    if (process.env.DEBUG_CALL) console.log(`  [state] ${p.identity}: ${JSON.stringify(changed)}`);
    if (!next || next === state) return;
    if (next === "speaking") {
      spokeAt = Date.now();
      if (waitingSince) replyTimes.push(Date.now() - waitingSince);
      waitingSince = 0;
    }
    if (state === "speaking" && next !== "speaking") quietAt = Date.now();
    state = next;
  });
  let agentLeft = false;
  room.on(RoomEvent.ParticipantDisconnected, () => (agentLeft = true));
  // How loud the agent is, per second: proof its voice reaches the room.
  room.on(RoomEvent.TrackSubscribed, (track) => {
    if (track.kind !== TrackKind.KIND_AUDIO || !process.env.DEBUG_CALL) return;
    (async () => {
      let sum = 0, n = 0, last = Date.now();
      for await (const frame of new AudioStream(track, RATE, 1)) {
        for (const v of frame.data) { sum += v * v; n++; }
        if (Date.now() - last >= 1000) {
          const rms = Math.sqrt(sum / Math.max(1, n));
          if (rms > 50) console.log(`  [agent audio] rms ${Math.round(rms)}`);
          sum = 0; n = 0; last = Date.now();
        }
      }
    })().catch(() => undefined);
  });
  await room.connect(started.url, started.token, { autoSubscribe: true, dynacast: false });
  const source = new AudioSource(RATE, 1);
  const track = LocalAudioTrack.createAudioTrack("mic", source);
  await room.localParticipant.publishTrack(track, { source: TrackSource.SOURCE_MICROPHONE });

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "test-call-"));
  // Keep the line alive with silence between turns, like a real microphone.
  let speaking = false;
  const keepAlive = (async () => {
    while (!agentLeft && room.isConnected) {
      if (!speaking) await play(source, silence(100));
      else await sleep(20);
    }
  })();

  for (const line of say) {
    // Wait for the agent to have spoken and gone quiet for a moment.
    for (let t = 0; t < 30000 && !(spokeAt && quietAt > spokeAt && state === "listening" && Date.now() - quietAt > 1500); t += 100) await sleep(100);
    if (agentLeft) break;
    spokeAt = 0;
    const pcm = speech(line, dir);
    speaking = true;
    console.log(`  you: ${line}`);
    await play(source, pcm);
    speaking = false;
    waitingSince = Date.now();
  }
  // Let the agent finish (it hangs up at the workflow's end).
  for (let t = 0; t < 30000 && !agentLeft; t += 200) await sleep(200);
  await room.disconnect();
  await keepAlive.catch(() => undefined);

  let call;
  for (let t = 0; t < 30; t++) {
    call = (await api("GET", `${ws}/calls/${started.callId}`)).call;
    if (!call.live) break;
    await sleep(1000);
  }
  console.log("\nTranscript:");
  for (const l of call.transcript) console.log(`  ${l.who.padEnd(6)} ${l.at != null ? String(l.at).padStart(3) + "s" : "    "}  ${l.text}`);
  console.log(`\nSaved:   ${JSON.stringify(call.saved)}`);
  console.log(`Path:    ${(call.path || []).join(" → ")}`);
  console.log(`Outcome: ${call.outcome} (${call.endReason}, ${call.durationSec} s)${call.missing ? `, missing ${call.missing.join(", ")}` : ""}`);
  console.log(`Summary: ${call.summary}`);
  console.log(`Reply times (end of your line → agent speaking): ${replyTimes.map((ms) => (ms / 1000).toFixed(1) + " s").join(", ")}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
