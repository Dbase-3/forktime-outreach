# forktime-outreach

Outbound voice agent + the web app that runs it. The agent phones restaurants, discloses that it is an AI calling for a named rep at Forktime, asks for the owner, and connects an interested owner to the rep. Separate from forktime-core on purpose: own repo, own database, own LiveKit agent name (`outreach-agent`), own deploy.

> Update this file in the same commit as any structural change (a new route, event, setting, env var, or rule).

## Product rules (owner + build decisions, 2026-11-20). Do not weaken these.

- **What the call is (owner, 2026-11-20):** Aadeel really wants to arrange a large booking and is too busy to phone around, so the AI calls on his behalf, finds the owner, and connects them to him to talk directly. The booking is real; the agent has none of its details and takes no booking. It says so: "Hi, this is Sara, an AI assistant calling on behalf of Aadeel, about a large booking he'd like to arrange. This call is recorded. Is the owner or manager around?"
- **The owner flow (owner, 2026-11-20):** once the agent has the owner or a deciding manager it asks three real questions, one at a time: do you take large bookings, roughly how many can you seat, do you have vegetarian or vegan options. A place that takes no large bookings or seats well under 20 gets a warm goodbye (`not_a_fit`), no pitch. Otherwise ONE soft mention, honestly worded: Aadeel also works with restaurants on an AI phone assistant that answers calls and takes bookings, "which is what I am". It does NOT pass the call to Aadeel unless the owner clearly says yes or asks to talk to him (`transfer_to_rep`). Answers are filed on the call (`takesLargeBookings`, `seats`, `capacityNote`, `vegetarianVegan`, `interestedInSystem`) and shown in the call panel: that is the filter per number.
- **Staff get the call-back number again** (owner, 2026-11-20, reversing "no number"): the agent asks when the owner is free, then says the number slowly, EXACTLY as the spoken string in the prompt (an earlier build left it out and the model invented a number; `tests/agent.test.js` + the `mustSay` checks in `scripts/sim.js` pin it), offers to repeat it, and only then ends the call.
- **Inbound call-backs** (owner, 2026-11-20): the call-back number is meant to reach this agent. A LiveKit SIP dispatch rule for that number with agent name `outreach-agent` sends the call here (the owner sets up the trunk and rule; nothing in this repo touches telephony). With no call details in the room, the agent reads the caller's number from the phone participant (`sip.phoneNumber`), asks the app (`POST /api/agent/inbound`, agent key), which opens an inbound call record (`direction: "inbound"`, never takes the dialling line) and returns the call's details plus what was noted on the last call to that number (`previousNoteOf`). It opens differently ("thanks for calling back! ... I called earlier for Aadeel about a large booking ... Am I speaking with the owner?", or a general welcome for an unknown caller) and carries on from the notes without re-asking answered questions. The flow after the welcome is the same as outbound.
- **The welcome messages are editable in Settings (owner, 2026-11-20: "easy for Aadeel to fine tune").** Three templates in `settings` (`welcomeOutbound`, `welcomeCallbackKnown`, `welcomeCallbackNew`) with `{agent}` `{rep}` `{topic}` `{recorded}` placeholders, rendered by `renderWelcome` in `apps/web/lib/opening-line.ts` (defaults in `DEFAULT_WELCOME`; a blank or missing template falls back to them, so older saved settings keep working). Saving is refused unless every message, once filled in, says it is an AI and names the rep (`welcomeProblem`); the agent's own `hasDisclosure` check stays as the second guard. They are web-side only: the agent speaks the text it is handed, so changing wording never needs an agent deploy.
- **The AI is never hidden and nothing is invented.** (Owner asked on 2026-11-20 to take "AI" out of the welcome and reveal it at the end "for the wow", and to say the call is "on behalf of customers" while qualifying restaurants for a Forktime pitch. That was declined: the welcome says it is an AI, and the questions are asked as Aadeel's own.) The opening line is built by the app (`apps/web/lib/opening-line.ts`), spoken word for word and uninterruptibly, and replaced by the agent's own if it fails `hasDisclosure` (AI + the rep's first name, mirrored in `apps/agent/src/opening.js`). Date, party size, budget: the agent never produces them ("Aadeel will go through all of that himself"); the practice conversations check it.
- **"What the call is about" in Settings must be TRUE for every number in the queue**: the agent says it on every call. If the list includes restaurants Aadeel does not mean to book at, the call is a pretext; an earlier request to hide the AI and pose as a customer was declined and is not built.
- **A no is a no.** "Not interested" / "stop" from anyone ends the call; "don't call again" puts the number on the do-not-call list.
- Whoever picks up is staff until they say they are the owner or manager; only they are offered the transfer. **Staff get no details and no phone number** (owner, 2026-11-20: "no one can note a number in a busy restaurant"): the agent asks when the owner will be available, files it as `callbackTime`, and the team calls back then, by hand or from the app (`Schedule` on a finished call sets `notBefore`; the queue dials it when due). A scheduled call is only dialled while the queue is running AND something ticks it (an open screen or an agent event): there is no background timer yet. `settings.callbackNumber` still exists but is unused and no longer required to start.
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
- **Voice company** (`settings.voiceProvider`, `elevenlabs` | `fishaudio`; owner 2026-11-20: "Fish Audio, the closest to human"). `voiceSetup` in `src/config.js` builds the right plugin options: Fish Audio uses `s2.1-pro`, 16 kHz, low latency, temperature 0.6, and takes the speed natively (clamped to 1 to 1.2, no model switch), exactly as the phone agent does; the key is `FISH_API_KEY` (agent env only). Settings saved before this field exist read back as ElevenLabs. There is no backup voice: if Fish is down, the call is silent.
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
