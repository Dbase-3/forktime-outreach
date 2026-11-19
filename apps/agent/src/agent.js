"use strict";

/**
 * The outreach voice agent: a LiveKit worker with its own agent name, so it
 * only ever joins rooms the outreach app dispatches it into. It never answers
 * an inbound call and never shares a dispatch with the Forktime phone agent.
 *
 *   pnpm dev:agent      (from the repo root; reads apps/agent/.env)
 */

const { env, VOICE } = require("./config");
require("events").EventEmitter.defaultMaxListeners = 100;

const { ServerOptions, cli, defineAgent } = require("@livekit/agents");
const silero = require("@livekit/agents-plugin-silero");

/** The call's details, as the app put them on the dispatch. Null when this is not one of ours. */
function parseMetadata(raw) {
  if (!raw) return null;
  try {
    const meta = JSON.parse(raw);
    return meta && meta.kind === "outreach" && meta.callId && meta.phone ? meta : null;
  } catch {
    // Not JSON: not a call this agent was sent to.
    return null;
  }
}

const agent = defineAgent({
  prewarm: async (proc) => {
    proc.userData.vad = await silero.VAD.load(VOICE.vad);
    console.log(`[Outreach] ready (${env.agentName()})`);
  },

  entry: async (ctx) => {
    // Required here, not at the top: the plugins open clients when loaded.
    const { OutreachCall } = require("./call");
    await ctx.connect();
    const meta = parseMetadata(ctx.job.metadata) || parseMetadata(ctx.room.metadata);
    if (!meta) {
      console.error(`[Outreach] room ${ctx.room.name} has no outreach call details; leaving`);
      ctx.shutdown("not an outreach call");
      return;
    }

    const call = new OutreachCall({ ctx, meta, vad: ctx.proc.userData.vad });
    ctx.addShutdownCallback(async () => {
      await call.finalize("error").catch(() => undefined);
    });
    try {
      await call.run();
    } catch (err) {
      console.error("[Outreach] call failed:", (err && err.stack) || err);
      await call.finalize("error").catch(() => undefined);
    }
  },
});

module.exports = agent;
module.exports.parseMetadata = parseMetadata;

// Run as a worker only when started directly; tests load this file for its helpers.
if (require.main === module) {
  cli.runApp(
    new ServerOptions({
      agent: __filename,
      agentName: env.agentName(),
      numIdleProcesses: parseInt(process.env.AGENT_IDLE_PROCESSES || "1", 10),
      jobMemoryWarnMB: 700,
    }),
  );
}
