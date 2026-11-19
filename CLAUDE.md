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
- **The opening line starts the moment they stop saying hello** (owner, 2026-11-20: "people pick up and say hello hello, they won't hear the welcome"). Three parts: its audio is made while the phone rings (`prepareOpening`, played through `say(text, { audio })`); it is triggered by the voice detector's speaking → listening change, not by the transcript arriving; and if they say nothing it starts 0.9 s after pickup (`TIMING.openingWaitMs`). It is uninterruptible, so a second "hello?" does not cut the disclosure off.
- **Anything said before the opening line has finished is dropped by the SDK** (`StopResponse` in `onUserTurnCompleted` discards the turn; it never reaches the chat history). `onEarlyWords` keeps it: every line goes to the transcript, and the first one is judged (`lineCheck`) and added to the model's instructions (`updateInstructions`, "When they picked up … they said"), so "Luigi's, owner speaking" is not lost.
- **Speaking speed** (`settings.voiceSpeed`, 1 to 1.2; `ttsOptions` in `src/config.js`): v4 Turbo is a dialogue model and takes only `stability`, so the plugin ignores `speed` on it. Normal speed = v4 Turbo; anything faster = `eleven_flash_v2_5` at that speed. Measured on one line with the Canadian voice: 9.4 s on v4 Turbo, 6.8 s on Flash at 1.2. The default voice is `canadian-female-upbeat` (`TgnhEILA8UwUqIMi20rp`).
- **Tools return `undefined`** (`transfer_to_rep`, `end_call`). In this SDK a tool that returns nothing makes the model NOT speak again. The tool only records what was asked (`this.pending`); `runPending` runs on `FunctionToolsExecuted`, after the agent has stopped speaking. Do not `await` speech inside a tool.
- The goodbye rides in `end_call.goodbye` and is spoken by the call itself, because the model often called the tool without saying anything (found in practice runs: it hung up on "not interested" in silence).
- **Who answered** (`src/lineCheck.js`): the first thing heard gets a one-word model judgment (voicemail / menu / person; doubt = person). A recording followed by 4 s of silence after the opening line ends the call (`handleQuietLine`). Asking the model to notice a recording mid-conversation was unreliable.
- Transfer (`src/transfer.js`): the owner stays in the room, the rep is dialled in with a ring tone (`playDialtone`, `waitUntilAnswered: true`), then the agent session closes and the agent stays silent until either hangs up. If the rep does not pick up, the agent says so and takes a call-back time.
- Recording: LiveKit Egress, audio only, to `outreach/<callId>-<attempt>.ogg` in the bucket from `EGRESS_S3_*` (same mechanism as the phone agent).
- A call the model never filed is filed once from its transcript (`src/wrapup.js`).

## Deploy

- `pnpm setup:prod` writes `apps/web/.env.vercel` (paste into Vercel; root directory `apps/web`) and `apps/agent/.env.prod`. Production has its own login password, session secret and agent key, `DIAL_MODE=live`, and `MONGODB_URI` = the Forktime database server with the database name `forktime_outreach` (`outreachMongoUri` in `scripts/setup-env.mjs`; it keeps the original database as `authSource`, or the sign-in fails on a non-SRV address). That login is the Forktime cluster's admin user: a dedicated user scoped to `forktime_outreach` is owed.
- **The agent is deployed on LiveKit Cloud (2026-11-20, owner said "deploy")**: agent `CA_9A5PQfcpoAfH` in the `ground-labs` project, region `us-east` like the phone agents, id recorded in `apps/agent/livekit.toml`. `lk agent create` needs a real terminal even with `--silent` (it asks to confirm the project); from a non-interactive shell wrap it in `expect` and answer `y` to that one question. `lk agent status` and `lk agent logs` show it; a healthy start logs `[Outreach] ready (outreach-agent)`.
- The agent in production: `pnpm deploy:agent` (`apps/agent/scripts/deploy.sh`: `lk agent create` the first time, `lk agent deploy` after, secrets from `.env.prod`; refuses a local `OUTREACH_WEB_URL`). `apps/agent/livekit.toml` names the LiveKit project (the same one as the Forktime phone agent). `pnpm dev:agent:prod` runs the worker locally on `.env.prod` (`OUTREACH_ENV_FILE`).
- Vercel project: `forktime-outreach` in the GetFork AI team, production branch `main`, root directory `apps/web`. `apps/web/package.json` pins Node to 20 or 22 (`engines`): a new Vercel project defaults to a newer Node than Next 14 is tested on. Vercel builds on a push; a project created after the push has nothing to build until the next one.
- Every `.env*` file is git-ignored. Branches follow the Forktime flow: `staging` first, then `main`.
- The web tests use `mongodb-memory-server-core` on purpose: the full package downloads a MongoDB binary at install time, which a Vercel build would do too.

## Tests and checks

- `pnpm test`: web (vitest, real throwaway MongoDB via mongodb-memory-server; the dial is the one thing mocked) and agent (vitest, no network).
- `pnpm --filter @outreach/agent sim [new|all|<name>]`: practice conversations against the real model in text mode. Costs cents; uses `ANTHROPIC_API_KEY_EVAL`. The second set (`new`) exists so a wording fix tuned on the first set is checked elsewhere; run `all` after any prompt change. State of 2026-11-20: 16 of 16.
- Not yet verified on a real phone line: the voice pipeline end to end, the transfer, the recording. The first real call should be to the owner's own mobile.

## A silent call (2026-11-20)

The owner's first real call (to his own mobile, +92) connected and was silent both ways. The recording had the agent's opening line and nothing from his side; Telnyx showed a normal answered call (G722, he hung up); the agent log had no error. A second call minutes later from the same app, agent and trunk to a demo restaurant's line (answered by the Forktime phone AI) carried sound both ways. So the stack works and that one call lost its audio between the carrier and his phone. To check any call: the recording (is the agent in it? is the other side?), Telnyx `detail_records`, `lk agent logs`. A demo line answered straight by the phone AI is the two-way test with no human needed.

## Gotchas

- Requiring the LiveKit plugins keeps a Node process alive: a one-off script must call `process.exit()`.
- Outside a worker the SDK logger is not set up: call `initializeLogger()` before creating an `AgentSession` (see `scripts/sim.js`).
- `apps/agent/src/agent.js` only calls `cli.runApp` when run directly, so tests can import it.
- Never give the worker an empty `agentName`: without a name LiveKit would dispatch it into every new room of the project, including the Forktime phone agent's calls.
- The env files hold live provider keys copied from forktime-core. Print key names only, never values.
- `pnpm setup` points at the SAME LiveKit project and Telnyx trunk as production Forktime. Fine for test calls to your own phone; real outreach should use its own numbers (ideally its own carrier account).
