# forktime-outreach

Outbound voice agent + the web app that runs it. The agent phones restaurants, discloses that it is an AI calling for a named rep at Forktime, asks for the owner, and connects an interested owner to the rep. Separate from forktime-core on purpose: own repo, own database, own LiveKit agent name (`outreach-agent`), own deploy.

> Update this file in the same commit as any structural change (a new route, event, setting, env var, or rule).

## Product rules (owner + build decisions, 2026-11-20). Do not weaken these.

- **The agent is honest by construction.** Its first words are a fixed line built by the app (`apps/web/lib/opening-line.ts`): AI assistant, who it calls for, the company, the topic, the recording notice, then "Is the owner or manager around?". The agent speaks it word for word, uninterruptibly, and replaces any handed line that fails `hasDisclosure` with its own (`apps/agent/src/opening.js`).
- **It is never a customer.** The owner's first idea was a pretext ("I want to make a large booking, get me the owner"). That was declined and is not built: no fake booking, no hidden AI. The instructions say so, the practice conversations check it (`NEVER` in `scripts/sim.js`), and a test pins that the prompt contains no such wording. Do not add a "reason for calling" that is not true.
- **A no is a no.** "Not interested" / "stop" from anyone ends the call; "don't call again" puts the number on the do-not-call list (`outcome: do_not_call`), which the queue never dials again.
- **Staff get no details**, only the call-back number. Only an owner or deciding manager who says yes is transferred.
- Calls go out one at a time, inside the calling window, at most `maxAttempts` tries (only an unanswered call is retried).

## Layout

```
apps/web     Next.js 14 (App Router), MongoDB driver, TanStack Query, Tailwind. Port 3100.
apps/agent   LiveKit Agents JS 1.9.2 worker (CommonJS), official plugins only.
scripts/setup-env.mjs   writes both env files; copies provider keys BY NAME from ../forktime-core, prints names only.
```

### apps/web

- `lib/queue.ts` pure decisions (`planNext`, `staleVerdict`, `retryPlan`); `lib/queue-runner.ts` `advanceQueue()` reads the DB, asks them, acts. Idempotent and safe to call from anywhere: the screen calls it every few seconds (`GET /api/queue`), and the agent's "ended" event calls it so the queue moves with no screen open.
- **One call at a time is enforced by the database**: a unique partial index on `calls.active` (`lib/db.ts`). `claimForDial` returns null on the duplicate-key error. Do not replace this with an in-memory lock.
- `lib/dialer.ts` places a real call: LiveKit room (metadata = the call's details) → agent dispatched by name → `createSipParticipant` with identity `callee`, `waitUntilAnswered: false`. Same shape as forktime-core `DemoCallService`.
- `lib/simulate.ts` is the dry run (`DIAL_MODE` anything but `live`): scripted calls advanced by the clock, nothing dialled, calling hours ignored.
- `lib/agent-events.ts` is the ONLY writer for what the agent reports (`POST /api/agent/events`, header `x-agent-key`). Events: `answered`, `transcript`, `stage`, `not_answered`, `ended`, `recording`. An event whose `attempt` is not the call's current attempt is ignored.
- `lib/outcomes.ts`: `AGENT_OUTCOMES` (what the agent may file) + `SYSTEM_OUTCOMES`. `tests/agent-contract.test.ts` fails if the agent's copy drifts.
- Auth: one operator from env (`ADMIN_EMAIL` / `ADMIN_PASSWORD`), signed cookie (`lib/session.ts`, jose), `middleware.ts` guards everything except `/login`, `/api/auth/login`, `/api/agent/events`.
- Settings are one document (`lib/settings.ts`); phone numbers are stored in E.164 and a number that can't be parsed is a validation error, never saved as typed.
- `lib/carrier.ts` lists the Telnyx account's numbers and ElevenLabs voices for the Settings pickers (read-only calls).

### apps/agent

- `src/call.js` `OutreachCall` is one call: wait for pickup (`sip.callStatus === "active"`), start the session, opening line, model conversation, transfer or end, file the call.
- Voice stack values are in `src/config.js` and mirror forktime-core's phone agent: Soniox `stt-rt-v6` (en, strict, `maxEndpointDelayMs` 800, booking key terms as context), ElevenLabs `eleven_v4_turbo` (`pcm_16000`, stability 0.6 only: v4 is a dialogue model), Claude `claude-haiku-4-5` with no thinking, Silero VAD 0.5, endpointing 600/1000 ms, telephony noise cancellation.
- **Turn detection differs from the phone agent**: default `TURN_DETECTOR=stt` (Soniox's own end-of-turn). `multilingual` uses LiveKit's model like the phone agent, but needs its model files (forktime-core restores them with `scripts/restore-turn-detector.mjs`; HuggingFace refuses the JS download).
- **Tools return `undefined`** (`transfer_to_rep`, `end_call`). In this SDK a tool that returns nothing makes the model NOT speak again. The tool only records what was asked (`this.pending`); `runPending` runs on `FunctionToolsExecuted`, after the agent has stopped speaking. Do not `await` speech inside a tool.
- The goodbye rides in `end_call.goodbye` and is spoken by the call itself, because the model often called the tool without saying anything (found in practice runs: it hung up on "not interested" in silence).
- **Who answered** (`src/lineCheck.js`): the first thing heard gets a one-word model judgment (voicemail / menu / person; doubt = person). A recording followed by 4 s of silence after the opening line ends the call (`handleQuietLine`). Asking the model to notice a recording mid-conversation was unreliable.
- Transfer (`src/transfer.js`): the owner stays in the room, the rep is dialled in with a ring tone (`playDialtone`, `waitUntilAnswered: true`), then the agent session closes and the agent stays silent until either hangs up. If the rep does not pick up, the agent says so and takes a call-back time.
- Recording: LiveKit Egress, audio only, to `outreach/<callId>-<attempt>.ogg` in the bucket from `EGRESS_S3_*` (same mechanism as the phone agent).
- A call the model never filed is filed once from its transcript (`src/wrapup.js`).

## Deploy

- `pnpm setup:prod` writes `apps/web/.env.vercel` (paste into Vercel; root directory `apps/web`) and `apps/agent/.env.prod`. Production has its own login password, session secret and agent key, `DIAL_MODE=live`, and `MONGODB_URI` = the Forktime database server with the database name `forktime_outreach` (`outreachMongoUri` in `scripts/setup-env.mjs`; it keeps the original database as `authSource`, or the sign-in fails on a non-SRV address). That login is the Forktime cluster's admin user: a dedicated user scoped to `forktime_outreach` is owed.
- The agent in production: `pnpm deploy:agent` (`apps/agent/scripts/deploy.sh`: `lk agent create` the first time, `lk agent deploy` after, secrets from `.env.prod`; refuses a local `OUTREACH_WEB_URL`). `apps/agent/livekit.toml` names the LiveKit project (the same one as the Forktime phone agent). `pnpm dev:agent:prod` runs the worker locally on `.env.prod` (`OUTREACH_ENV_FILE`).
- Every `.env*` file is git-ignored. Branches follow the Forktime flow: `staging` first, then `main`.
- The web tests use `mongodb-memory-server-core` on purpose: the full package downloads a MongoDB binary at install time, which a Vercel build would do too.

## Tests and checks

- `pnpm test`: web (vitest, real throwaway MongoDB via mongodb-memory-server; the dial is the one thing mocked) and agent (vitest, no network).
- `pnpm --filter @outreach/agent sim [new|all|<name>]`: practice conversations against the real model in text mode. Costs cents; uses `ANTHROPIC_API_KEY_EVAL`. The second set (`new`) exists so a wording fix tuned on the first set is checked elsewhere; run `all` after any prompt change. State of 2026-11-20: 16 of 16.
- Not yet verified on a real phone line: the voice pipeline end to end, the transfer, the recording. The first real call should be to the owner's own mobile.

## Gotchas

- Requiring the LiveKit plugins keeps a Node process alive: a one-off script must call `process.exit()`.
- Outside a worker the SDK logger is not set up: call `initializeLogger()` before creating an `AgentSession` (see `scripts/sim.js`).
- `apps/agent/src/agent.js` only calls `cli.runApp` when run directly, so tests can import it.
- Never give the worker an empty `agentName`: without a name LiveKit would dispatch it into every new room of the project, including the Forktime phone agent's calls.
- The env files hold live provider keys copied from forktime-core. Print key names only, never values.
- `pnpm setup` points at the SAME LiveKit project and Telnyx trunk as production Forktime. Fine for test calls to your own phone; real outreach should use its own numbers (ideally its own carrier account).
