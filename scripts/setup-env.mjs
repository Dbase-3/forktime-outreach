// Writes the env files this project needs.
//
//   pnpm setup         for your machine:
//     apps/web/.env.local   the app (login, database, dialling)
//     apps/agent/.env       the voice agent (speech, voice, model, recording)
//
//   pnpm setup:prod    for the deployed app:
//     apps/web/.env.vercel  paste into Vercel (Settings, Environment Variables)
//     apps/agent/.env.prod  the agent's secrets (`pnpm deploy:agent`, or `pnpm dev:agent:prod`)
//   Production gets its own login password, session secret and agent key,
//   places real calls (DIAL_MODE=live), and keeps its data in a database of its
//   own (forktime_outreach) on the Forktime database server.
//
// Provider keys are copied BY NAME from the Forktime phone agent's env files
// (../forktime-core/packages/{agent,backend}/.env) when they are there, so the
// same stack runs here. No value is ever printed. Secrets this project owns
// (the login password, the session secret, the key the agent signs its reports
// with) are generated once and kept on later runs.
//
//   pnpm setup

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const core = join(root, "..", "forktime-core", "packages");

function readEnv(file) {
  if (!existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match) out[match[1]] = match[2].replace(/^(["'])(.*)\1$/, "$2");
  }
  return out;
}

const sources = { agent: readEnv(join(core, "agent", ".env")), backend: readEnv(join(core, "backend", ".env")) };
const from = (name, ...order) => order.map((source) => sources[source][name]).find(Boolean) || "";
const secret = (bytes) => randomBytes(bytes).toString("base64url");

function writeEnv(file, title, entries) {
  const existing = readEnv(file);
  const report = [];
  const lines = [`# ${title}`, "# Written by scripts/setup-env.mjs. Edit freely: a value already here is kept on the next run.", ""];
  for (const [name, fill, note] of entries) {
    const kept = existing[name];
    const value = kept ?? fill();
    if (note) lines.push(`# ${note}`);
    lines.push(`${name}=${value}`);
    report.push(`  ${name.padEnd(28)} ${kept != null ? "kept" : value ? "set" : "EMPTY: fill this in"}`);
  }
  writeFileSync(file, `${lines.join("\n")}\n`, { mode: 0o600 });
  console.log(`\n${file.replace(`${root}/`, "")}`);
  console.log(report.join("\n"));
}

/**
 * The Forktime database server, with this project's own database name. A
 * plain (non-SRV) address signs in against the database named in it unless it
 * says otherwise, so the original name is kept as the sign-in database.
 */
function outreachMongoUri(coreUri) {
  const match = /^(mongodb(?:\+srv)?:\/\/[^/]+)\/([^?]*)(\?.*)?$/.exec(coreUri || "");
  if (!match) return "";
  const [, server, database, query = ""] = match;
  const needsAuthSource = !server.startsWith("mongodb+srv") && !/[?&]authSource=/i.test(query);
  const withAuth = needsAuthSource ? `${query ? `${query}&` : "?"}authSource=${database || "admin"}` : query;
  return `${server}/forktime_outreach${withAuth}`;
}

const prod = process.argv.includes("--prod");
const webFile = join(root, "apps", "web", prod ? ".env.vercel" : ".env.local");
const agentFile = join(root, "apps", "agent", prod ? ".env.prod" : ".env");
const eventsKey = readEnv(webFile).AGENT_EVENTS_KEY || readEnv(agentFile).AGENT_EVENTS_KEY || secret(32);

writeEnv(webFile, prod ? "Forktime Outreach: the app, in production (for Vercel)" : "Forktime Outreach: the app", [
  ["ADMIN_EMAIL", () => "ops@outreach.local", "The one operator login."],
  ["ADMIN_PASSWORD", () => secret(prod ? 21 : 15)],
  ["SESSION_SECRET", () => secret(48)],
  ["AGENT_EVENTS_KEY", () => eventsKey, "Shared with apps/agent/.env: the agent signs its reports with it."],
  prod
    ? ["MONGODB_URI", () => outreachMongoUri(sources.backend.MONGO_URI), "This project's own database (forktime_outreach) on the Forktime database server."]
    : ["MONGODB_URI", () => "mongodb://127.0.0.1:27027/forktime_outreach", "`pnpm db` runs a local database here. Production: a real MongoDB."],
  ["DIAL_MODE", () => (prod ? "live" : "dry"), '"dry": no phone rings, calls are acted out on screen. "live": real calls.'],
  ["OUTREACH_AGENT_NAME", () => "outreach-agent"],
  ["LIVEKIT_URL", () => from("LIVEKIT_URL", "agent", "backend")],
  ["LIVEKIT_API_KEY", () => from("LIVEKIT_API_KEY", "agent", "backend")],
  ["LIVEKIT_API_SECRET", () => from("LIVEKIT_API_SECRET", "agent", "backend")],
  ["SIP_OUTBOUND_TRUNK_ID", () => from("TELNYX_OUTBOUND_TRUNK_ID", "agent", "backend"), "LiveKit outbound trunk ids. Australian numbers use the _AU one when set."],
  ["SIP_OUTBOUND_TRUNK_ID_AU", () => from("TELNYX_OUTBOUND_TRUNK_ID_AU", "agent", "backend")],
  ["TELNYX_API_KEY", () => from("TELNYX_API_KEY", "backend"), "Only to list the account's numbers in Settings."],
  ["ELEVENLABS_API_KEY", () => from("ELEVENLABS_API_KEY", "agent"), "Only to list voices and their samples in Settings."],
]);

writeEnv(agentFile, prod ? "Forktime Outreach: the voice agent, in production" : "Forktime Outreach: the voice agent", [
  ["OUTREACH_AGENT_NAME", () => "outreach-agent"],
  ["OUTREACH_WEB_URL", () => (prod ? "" : "http://localhost:3100"), prod ? "The deployed app's address (https://...). FILL THIS IN after the first Vercel deploy." : "Where the app runs; the agent posts its reports here."],
  ["AGENT_EVENTS_KEY", () => eventsKey],
  ["LIVEKIT_URL", () => from("LIVEKIT_URL", "agent", "backend")],
  ["LIVEKIT_API_KEY", () => from("LIVEKIT_API_KEY", "agent", "backend")],
  ["LIVEKIT_API_SECRET", () => from("LIVEKIT_API_SECRET", "agent", "backend")],
  ["SIP_OUTBOUND_TRUNK_ID", () => from("TELNYX_OUTBOUND_TRUNK_ID", "agent", "backend")],
  ["SIP_OUTBOUND_TRUNK_ID_AU", () => from("TELNYX_OUTBOUND_TRUNK_ID_AU", "agent", "backend")],
  ["ANTHROPIC_API_KEY", () => from("ANTHROPIC_API_KEY", "agent")],
  ["ANTHROPIC_API_KEY_EVAL", () => from("ANTHROPIC_API_KEY_EVAL", "agent"), "Used by `pnpm sim` (practice conversations), so test spend stays off the live key."],
  ["SONIOX_API_KEY", () => from("SONIOX_API_KEY", "agent", "backend")],
  ["ELEVENLABS_API_KEY", () => from("ELEVENLABS_API_KEY", "agent")],
  ["OUTREACH_LLM_MODEL", () => "claude-haiku-4-5"],
  ["TURN_DETECTOR", () => "stt", '"stt" or "multilingual" (LiveKit\'s end-of-turn model; needs its model files downloaded).'],
  ["EGRESS_S3_BUCKET", () => from("EGRESS_S3_BUCKET", "agent"), "Where call recordings are stored. Leave empty to not record."],
  ["EGRESS_S3_ACCESS_KEY", () => from("EGRESS_S3_ACCESS_KEY", "agent")],
  ["EGRESS_S3_SECRET", () => from("EGRESS_S3_SECRET", "agent")],
  ["EGRESS_S3_ENDPOINT", () => from("EGRESS_S3_ENDPOINT", "agent")],
  ["EGRESS_S3_REGION", () => from("EGRESS_S3_REGION", "agent") || "auto"],
  ["EGRESS_S3_PUBLIC_URL", () => from("EGRESS_S3_PUBLIC_URL", "agent")],
]);

console.log(
  prod
    ? "\nDone. Paste apps/web/.env.vercel into Vercel. The login is ADMIN_EMAIL and ADMIN_PASSWORD in that file.\nThen put the deployed address in OUTREACH_WEB_URL in apps/agent/.env.prod."
    : "\nDone. The login email and password are ADMIN_EMAIL and ADMIN_PASSWORD in apps/web/.env.local.",
);
