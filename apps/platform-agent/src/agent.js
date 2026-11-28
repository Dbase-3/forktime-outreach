"use strict";

/**
 * The platform's voice agent: runs any agent a customer builds in the editor.
 * A LiveKit worker with its own name (PLATFORM_AGENT_NAME), so it only joins
 * rooms the platform API sends it to, never the outreach or Forktime calls.
 *
 *   pnpm dev:platform-agent      (from the repo root; reads apps/platform-agent/.env)
 */

const { env, VOICE } = require("./config");
require("events").EventEmitter.defaultMaxListeners = 100;

const { ServerOptions, cli, defineAgent } = require("@livekit/agents");
const silero = require("@livekit/agents-plugin-silero");

/** The call this room is for, from the dispatch. Null when it isn't one of ours. Pure. */
function callIdFrom(raw) {
  try {
    const meta = JSON.parse(raw || "");
    return meta && meta.kind === "platform" && typeof meta.callId === "string" && /^[a-f0-9]{24}$/.test(meta.callId) ? meta.callId : null;
  } catch {
    // Not JSON: not a call this agent was sent to.
    return null;
  }
}

const agent = defineAgent({
  prewarm: async (proc) => {
    proc.userData.vad = await silero.VAD.load(VOICE.vad);
    console.log(`[Platform] ready (${env.agentName()})`);
  },

  entry: async (ctx) => {
    // Required here: the plugins open clients when loaded.
    const { createApi } = require("./api");
    const { PlatformCall } = require("./call");
    await ctx.connect();
    const callId = callIdFrom(ctx.job.metadata) || callIdFrom(ctx.room.metadata);
    if (!callId) {
      console.error(`[Platform] room ${ctx.room.name} has no call; leaving`);
      ctx.shutdown("unknown call");
      return;
    }
    const api = createApi({ baseUrl: env.apiUrl(), key: env.runtimeKey(), callId });
    let cfg;
    try {
      cfg = await api.setup();
    } catch (err) {
      console.error(`[Platform] call ${callId}: no setup (${err.message}); leaving`);
      ctx.shutdown("no setup");
      return;
    }
    console.log(`[Platform] call ${callId}: ${cfg.flow.name}${cfg.test ? " (test)" : ""}`);
    // A phone call: the phone's participant, whoever else joins (the owner may listen in from the browser).
    const { phoneIdentityFrom } = require("./phone");
    const phone = phoneIdentityFrom(ctx.job.metadata) || phoneIdentityFrom(ctx.room.metadata);
    const participant = await ctx.waitForParticipant(phone || undefined);
    const call = new PlatformCall({ ctx, api, cfg, vad: ctx.proc.userData.vad });
    ctx.addShutdownCallback(async () => {
      await call.finalize("failed").catch(() => undefined);
    });
    try {
      await call.start(participant, { phone: Boolean(phone) });
    } catch (err) {
      console.error("[Platform] call failed:", (err && err.stack) || err);
      await call.finalize("failed").catch(() => undefined);
    }
  },
});

module.exports = agent;
module.exports.callIdFrom = callIdFrom;

// Run as a worker only when started directly; tests load this file for its helpers.
if (require.main === module) {
  cli.runApp(new ServerOptions({ agent: __filename, agentName: env.agentName(), numIdleProcesses: parseInt(process.env.AGENT_IDLE_PROCESSES || "1", 10), jobMemoryWarnMB: 700 }));
}
