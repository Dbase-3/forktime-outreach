# Forktime Outreach

An AI assistant that phones restaurants about possible large-party bookings, asks for the owner, and connects an interested owner to Forktime. A small web app runs the calls and shows each one live.

On every call the assistant opens with one line that is always the same shape:

> "Hi, this is Sara calling about a possible large-party booking for a customer. This call is recorded. Is the owner or manager around?"

The customer remains unnamed: the assistant treats their identity and booking details as confidential. Once it has qualified an owner or manager, it explains that it is an AI assistant from Forktime and asks whether they would like to discuss Forktime's call-handling and booking solution. Staff are given no details, only a number to pass on.

## What is in here

| Folder | What it is |
| --- | --- |
| `apps/web` | The app: sign in, paste numbers, start and pause the calls, watch each call live, read the transcript, play the recording, change settings. Next.js, with its own MongoDB database. |
| `apps/agent` | The voice agent that makes the calls. A LiveKit worker: Soniox for listening, ElevenLabs for the voice, Claude Haiku 4.5 for the words. Same settings as the Forktime phone agent. |

The two talk in one direction: the agent posts what happens on a call to the app. Only the app touches the database.

## Run it on your machine

```bash
pnpm install
pnpm setup        # writes apps/web/.env.local and apps/agent/.env
pnpm db           # terminal 1: a local database (data kept in apps/web/.data)
pnpm dev:web      # terminal 2: the app, on http://localhost:3100
```

Sign in with `ADMIN_EMAIL` and `ADMIN_PASSWORD` from `apps/web/.env.local`.

`pnpm setup` copies the provider keys by name from the Forktime phone agent's env files when `../forktime-core` is next to this folder, and generates this project's own secrets. It prints key names only, and keeps any value already in the files.

### Dry run first

Out of the box `DIAL_MODE=dry`: **no phone rings**. Paste a few numbers, press **Start calling**, and the app acts each call out on screen (one reaches staff, one reaches an owner and connects, one hits voicemail). Use it to see the queue, the live transcript and the outcomes.

### Real calls

1. In **Settings**, set the number calls come from, the number an interested owner is connected to, and the call-back number restaurants can use to reach the agent.
2. In `apps/web/.env.local`, set `DIAL_MODE=live` and restart the app.
3. Start the voice agent: `pnpm dev:agent` (terminal 3).
4. Add your own mobile first, press **Start calling**, and answer it.

Calls go out one at a time, only inside the calling hours in Settings (2 to 5 PM on weekdays by default), and never to a number on the do-not-call list.

## Practice conversations

```bash
pnpm --filter @outreach/agent sim        # the first set (8 conversations)
pnpm --filter @outreach/agent sim new    # a second set with other restaurants and wordings
pnpm --filter @outreach/agent sim all
```

These run the agent's real instructions against the real model in text, with no phone and no voice, and check that it keeps the customer anonymous, takes a no at once, recognises voicemail, and connects an interested owner. Each run costs a few cents of model time and uses `ANTHROPIC_API_KEY_EVAL` when set. Run `all` after any change to the instructions.

## Tests

```bash
pnpm test         # app: 37 tests, agent: 24 tests (no network, no model spend)
pnpm typecheck
pnpm lint
```

## Putting it online

```bash
pnpm setup:prod   # writes apps/web/.env.vercel and apps/agent/.env.prod
```

**The app, on Vercel**

1. New Project, import this repository, and set **Root Directory** to `apps/web`.
2. Paste the contents of `apps/web/.env.vercel` into Environment Variables (Vercel reads a pasted .env file).
3. Deploy. Sign in with `ADMIN_EMAIL` and `ADMIN_PASSWORD` from that file.

Production places real calls (`DIAL_MODE=live`) and keeps its data in its own database, `forktime_outreach`, on the Forktime database server. If the app shows a database error, the database's network access list does not allow Vercel yet.

**The voice agent**

Put the deployed app's address in `OUTREACH_WEB_URL` in `apps/agent/.env.prod`. Then either:

- `pnpm dev:agent:prod` runs the agent on your machine against the deployed app. Quickest way to make a first test call.
- `pnpm deploy:agent` deploys it to LiveKit Cloud (the first run creates the agent there). Calls then work with no machine of yours running.

## When an owner calls back

The call-back number is the caller ID restaurants use to return the call; the agent does not read it aloud. For a call to it to reach this agent, the number needs, in LiveKit, an inbound SIP trunk that includes it and a SIP dispatch rule for that trunk with the agent name `outreach-agent`. Then the agent recognises the caller's number, pulls up the earlier call to it, and carries on from what was noted. A number that is already attached to another agent (the Forktime phone agent) must not be reused.

## Before calling real restaurants

- **Use separate phone numbers, ideally a separate carrier account.** `pnpm setup` points this project at the same LiveKit project and Telnyx trunk as the Forktime phone agent, which is fine for calling your own phone. Complaints about outbound calls land on the account that carries every live restaurant's line.
- **Ask your lawyer** about calling businesses with an AI voice and about recording in each country you call. Keep the recording notice on where it is required.
- **Give the app its own database login.** `pnpm setup:prod` reuses the Forktime database login, which can read and write every Forktime database. Create a user that can only use `forktime_outreach` and put it in `MONGODB_URI` on Vercel.
