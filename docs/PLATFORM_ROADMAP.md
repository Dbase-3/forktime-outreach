# Platform: gaps, architecture and roadmap

*Written 2026-11-26 after a full trace of `apps/platform`, `apps/agent`, `apps/web` and forktime-core. Owner asked: find every gap, decide Nest vs Next for the backend, and plan the whole build so nothing is missed and everything is fast.*

The prototype (https://forktime-platform.vercel.app) is a complete, consistent **mock**. Everything lives in the browser and nothing dials. Agents and campaigns will run again and again at scale, so the gaps below are ranked by what breaks a real call or a real campaign first.

---

## 1. The decision: a separate NestJS backend

**Yes, build a separate NestJS backend.** Next.js stays as the front end only.

| Need | Next.js API routes | NestJS service |
|---|---|---|
| Campaign scheduler that wakes every few seconds, for every workspace | No long-running process; needs an outside cron | A worker process runs it |
| Dial queue with retries, back-off, pacing, concurrency caps | Not possible in request/response functions | BullMQ workers |
| Knowledge ingestion, embeddings, CRM syncs, post-call judging (minutes of work) | Function time limits | Background jobs |
| Agent events at hundreds of calls at once (transcripts, results) | Every line is a cold function call | One warm process with batching |
| Live screens (calls in progress, campaign progress) | Polling only | SSE / WebSocket gateway with a Redis adapter |
| Reuse what we already run | — | forktime-core is NestJS 11 + Mongoose + Redis + Bull + Telnyx + LiveKit; its services copy across |

**Shape**

```
forktime-outreach (pnpm monorepo)
  packages/core     the pure engine, shared by all three: types, conditions, flow-tree,
                    workflow interpreter (nextStep), variables, agent-data, campaign rules,
                    phone normalisation. Moved out of apps/platform/lib.
  apps/api          NestJS: REST + SSE, auth, all data, validation (calls packages/core)
  apps/api worker   same codebase, second entrypoint: scheduler, dialer, jobs (BullMQ)
  apps/agent        LiveKit worker "platform-agent": the generalised outreach agent
  apps/platform     Next.js front end (TanStack Query against apps/api)
  apps/web, apps/agent (Sara/Forkmate) stay as they are until the platform replaces them
```

**Why the shared `packages/core` matters:** the same workflow interpreter runs in Preview, in the agent on real calls, and in the API's validation. Preview can then never drift from a real call.

**Stores**
- **MongoDB.** The team runs it already. Contacts with any custom fields suit documents. Analytics read from roll-up collections, not raw calls.
- **Redis** for BullMQ, locks, rate limits, the SSE fan-out and caches.
- **R2/S3** for recordings and uploaded files, under a per-workspace prefix.
- **Vector search** for knowledge: MongoDB Atlas Vector Search if the cluster is Atlas, otherwise a small pgvector instance. *Decision needed.*

**Where it runs**
- **API and worker:** DigitalOcean with pm2 releases, the same pipeline as forktime-core (`deploy-{staging,prod}.yml`). The API and the worker run as separate processes so each scales on its own.
- **Agent:** LiveKit Cloud, in its **own LiveKit project**. Today outreach shares Forktime production's project. A mis-named worker could be dispatched into restaurant calls.
- **Front end:** stays on Vercel (`forktime-platform`).

---

## 2. Gaps

Tags: **[blocker]** stops real use · **[important]** needed before customers · **[later]**.

### 2.1 Agents (the repeatable unit)

**[blocker] How a real call runs the workflow is undefined.**
- Preview walks the tree mechanically. A real call needs the model to talk naturally, take answers given out of order or several at once, re-ask when unclear, and then still follow the steps.
- **Answer:** generalise the Forkmate pattern from `apps/agent/src/forkmate`, which went from failing to 15 of 15 practice runs passing twice.
  - A `note` tool generated from the agent's data schema records answers.
  - Code (`nextStep`) decides the next line.
  - The model speaks it.

**[blocker] Answers aren't typed before decisions.**
- Decisions compare raw strings. "Yeah, I reckon" isn't `is_yes`, and "next Tuesday" isn't a date.
- **Answer:** the `note` tool's typed arguments: boolean, number, ISO date in the agent's time zone, enum of choices. The model does the understanding; code never parses speech (house rule).

**[blocker] Actions are a single free-text "detail".** Each action needs real settings:
- **Transfer:** numbers, warm or cold, timeout, what to do if nobody answers.
- **Book:** calendar, length, availability.
- **Text:** body, sender, opt-out.
- **CRM:** object and field mapping.
- **Webhook:** URL, method, secret, payload, timeout, whether the reply feeds back into the call.

**[blocker] No versions.**
- A Live agent is edited in place, keystroke by keystroke, while campaigns run it.
- **Answer:** draft vs published versions. A call records the version it ran. A campaign runs the published version.

**[blocker] Missing call behaviour:**
- max call length, silence timeout;
- voicemail behaviour (leave a message or hang up);
- opening hours and after-hours behaviour;
- a fallback when the agent fails;
- "stop calling me" adding the person to do-not-call;
- language detection;
- recording disclosure per region.

**[important] Tools (MCP/API)** have no method, auth, input/output schema or timeout.

**[important] Knowledge on calls** has no retrieval: no chunking, embeddings or `search_knowledge` tool, and no size budget per agent.

**[important] Language** is a display name, not a BCP-47 code. Voices are English accents only. `{today}` is Australian-formatted. Write with AI isn't told the language.

**[important] Renaming an Ask field silently breaks** write-backs, follow-ups, variables and required flags. Only decisions get checked.

**[important] Missing everyday actions:** no delete, duplicate or archive for agents.

**[important] Variables need a fallback:** `{first_name|there}`. An unknown inbound caller would otherwise hear the raw braces.

**[later] Write with AI is missing context.** It should get knowledge, integrations, language and time zone, and stop overwriting "Used for".

### 2.2 Campaigns

**[blocker] No scheduler and no per-contact state.**
- **Answer:** a `CampaignEnrollment` per contact and campaign: state, attempt, next attempt time, last call, exit reason.
- Retries, caps, follow-ups and "keep calling" all hang off it.

**[blocker] Time zones.**
- Contacts have no time zone, although "in each person's time zone" is on by default.
- **Answer:** contacts get a `timezone`, guessed from the number plus postcode or state where known. When it's unknown, call only in the hours that are legal across the whole country.
- `startAt` is stored with no zone (bug B5). The date-trigger maths breaks on daylight-saving days (bug B4).

**[blocker] Compliance is missing:**
- The do-not-call list is never read (bug B25).
- No scrubbing against national registers: AU DNCR, US DNC, UK TPS.
- No consent record per contact. In the US, AI voices need prior consent (FCC 2024).
- No legal-hours rule per country, and no public holidays.

**[blocker] Running campaigns aren't protected.**
- Agent, audience and hours stay editable mid-run.
- The agent can be made draft or lose its number.
- **Answer:** lock the risky fields while running, re-check on every tick, and auto-pause with a reason.

**[blocker] "Who gets called" isn't defined for each trigger.**
- "Call everyone once": is the audience frozen at Start?
- "When they join": are existing matches included?
- "When a field changes": needs a change log.
- "On a schedule": needs weekday and time.
- None of the triggers has a re-entry rule.

**[important] Throttling across campaigns:**
- The weekly cap applies within one campaign only, so someone can get 3 calls from 3 campaigns.
- No workspace or number pacing.
- One number dialling thousands of times gets flagged as spam ("Scam Likely"). **Answer:** number pools / local caller ID, and STIR/SHAKEN attestation.

**[important] Retries:** which outcomes retry (busy, failed, voicemail), and a retry that lands outside hours rolls to the next window.

**[important] Follow-ups** fire only on an End outcome. They also need "no answer after every try" and "required answer missing".

**[important] Missing start checks:**
- agent has no number, or only answers calls;
- empty audience;
- start time in the past;
- empty "becomes" value;
- follow-up outcome not in the agent;
- write-back type mismatch;
- bad webhook URL.

**[important] Campaign `called`/`answered`** are counters nothing updates, and calls have no `campaignId`.

### 2.3 Contacts

**[blocker] Phones aren't normalised to E.164.**
- No default country, and no mobile vs landline.
- **Answer:** `libphonenumber-js` on import, edit and sync.

**[blocker] No de-duplication.**
- Re-importing a file duplicates everyone.
- Sync needs external ids, a conflict rule and a rule for deletions.

**[important] Field type changes or deletes** don't check what uses the field. Campaign rules keep stale fields that still run (bug B23).

**[important] Imported values aren't type-checked.** dd/mm dates are read as US mm/dd (bug B18). Semicolon CSVs aren't supported. Choice fields get no choices.

**[important] Deleting a contact orphans its calls.** Needs soft delete and a GDPR-style "delete my data" flow covering calls and recordings.

### 2.4 Calls and review

**[blocker] A call record is missing most of what a real call produces:**
- **Call details:** campaign and enrolment ids, attempt, agent version, from/to/number ids, carrier call id, SIP code, human or machine, nullable contact (unknown inbound callers).
- **Recording:** storage key and retention.
- **Transcript:** word timings.
- **Results:** the structured record with missing fields, check results with reasons, actions with payload and result.
- **Cost:** cost and minutes.

**[important] The "path through the flow" is recomputed** from today's agent and contact. It's wrong after edits, so store it on the call.

**[important] Success checks are never judged or shown** (`checkResults` unused).

**[important] The calls list has no paging.**

### 2.5 Analytics

**[blocker] Lead, engagement, mood and transfer-to** are only filled by the sample data.
- **Answer:** a post-call judge job with a versioned rubric and a cheap model, writing to the call.

**[blocker] "Won" is a regex on the sample's outcome names.**
- **Answer:** End steps get `success: true/false`, plus success checks.

**[important] "Answered" is defined two ways:** Home counts voicemail and busy as answered; Analytics doesn't (bug B10).

**[important] Best time to call** uses one time zone per country (all of Australia on Sydney time). It should use the contact's own zone.

**[important] Buckets and labels** use the browser's zone and Australian English.

**[important] Computed in the browser over every call.** **Answer:** daily roll-ups per workspace, agent and campaign; the API serves those.

### 2.6 Knowledge

**[blocker] The fetch route can be pointed at internal addresses (SSRF).**
- Redirects aren't re-checked.
- Only the host name is checked, not the address it resolves to: `localtest.me` → 127.0.0.1 passes (verified).
- 100.64/10 isn't blocked.
- Bodies are read in full before the limit applies.
- No auth or rate limit.
- **Fix before anything else on the public deploy.**

**[important] "Re-read daily" does nothing.** PDF and Word "wait" forever. Uploaded HTML keeps its tags. Sitemap indexes aren't followed. A closed tab leaves a document stuck on "reading".

### 2.7 Numbers

**[blocker] Nothing is enforced on a server.** "One number = one agent" is UI-only, and nothing routes inbound calls from a number to its agent.
- **Answer:** a unique index on `{numberId}` in agents; inbound dispatch looks up the number.

**[blocker] No real provisioning:**
- Telnyx search, buy and release (copy forktime-core `TelnyxProvisioningService` / `NumberProvisioningService` / `LiveKitProvisioningService`).
- Regulatory bundles (AU and UK need an address, US texting needs 10DLC).
- Monthly cost, status, porting.

### 2.8 Platform-wide

**[blocker] No accounts:** no workspaces, users, sign-in, roles, or `workspaceId` on anything.

**[blocker] No billing or metering:** call minutes, texts, numbers, AI writes; no spending caps.

**[blocker] Every rule lives only in the UI.** The server must re-check:
- one number per agent;
- go-live checks;
- campaign start checks;
- unique field keys;
- greeting disclosure.

**[blocker] Concurrency:** the whole workspace is saved last-write-wins. **Answer:** per-entity saves with a version check, and enrolment claims under a lock.

**[blocker] Integrations don't connect.** "Connect" stores a name. Needs OAuth, token refresh, encrypted secrets and per-workspace connections.

**[blocker] Write with AI is open to anyone on the public URL.**
- Its cap is per server instance, keyed on a header the client may be able to fake.
- Request sizes aren't capped.

**[important] No audit log, no confirmation on destructive actions,** and no public API or signed outbound webhooks.

### 2.9 Defects in the prototype (fix now; most are cheap)

| # | Where | What |
|---|---|---|
| B1 | `lib/store.ts:26` | Changing `SEED_VERSION` silently wipes every visitor's saved work, including on the review deploy |
| B2 | `lib/store.ts:32` | A full browser storage fails silently. A 6 MB text knowledge file breaks every later save |
| B3 | `lib/store.ts` | Two tabs overwrite each other (no `storage` event listener) |
| B4 | `lib/campaign.ts:91` | `dueDate` adds 24 h blocks: a day early across daylight-saving changes (verified for Sydney) |
| B5 | `campaign-editor.tsx:168` | Default start time is a UTC string in a local input, off by the browser's offset |
| B6 | `lib/flow-tree.ts:124` | `flowIssues` misses: a decision before its Ask, no End anywhere, operator wrong for the type, empty action details, steps after a decision whose both sides end |
| B7 | `agent-editor.tsx:181` | A Live agent can be made invalid (greeting cleared, number removed, End deleted) and stays Live |
| B8 | `flow-tree.ts` | The AI + recorded disclosure isn't a go-live check for hand edits |
| B9 | `agent-draft.ts:98` | The disclosure check is English-only; a correct Spanish greeting gets replaced |
| B10 | `stats.ts:12` vs `analytics.ts:83` | Two meanings of "answered" |
| B12 | `analytics.ts:36` | "Today" compares with the wrong window |
| B13 | `knowledge.ts:65` | HTML entity decoding produces NUL characters |
| B14 | `api/knowledge/fetch` | SSRF (section 2.6) |
| B18 | `conditions.ts:64` | dd/mm/yyyy is read as US mm/dd |
| B19 | `data-tab.tsx:60` | Row key = field key, which changes while typing (likely loses focus); `field_${n}` can repeat after a delete |
| B20–22 | `campaign-editor.tsx` | Duplicate write-back sources; write-backs to an invisible field; switching agent leaves stale outcomes and sources |
| B23 | `rules-editor.tsx`, `fields-tab.tsx` | Deleting or retyping a field leaves rules that still run on the old field |
| B24 | `contact-sheets.tsx:56` | Renaming a contact doesn't update `first_name` |
| B25 | `settings/page.tsx` | Do-not-call list and workspace calling hours are never read |
| B26 | settings, campaigns, contacts | No confirmation for Reset workspace, delete running campaign, bulk delete |
| B28 | `agent-editor.tsx:219` | Undo after Write with AI also throws away edits made while it was writing |
| B30 | `practice.ts:66` | Empty variables are spoken as `{first_name}` |
| B34 | `campaign.ts:44` | Audience doesn't exclude do-not-call numbers, empty phones or invalid phones |
| B35 | `campaign-editor.tsx:229` | Hours can't end at midnight |

---

## 3. How a real call works (target design)

```
Campaign tick (worker, every ~5 s)
  → claim due enrolments under a lock
      checks: legal hours in the contact's zone, campaign window, DNC, consent,
              caps, concurrency slots for workspace / campaign / number
  → BullMQ "dial" job (idempotent on enrolmentId + attempt)
  → LiveKit: create room (metadata = {callId, agentVersionId, vars}), dispatch "platform-agent",
    createSipParticipant from the agent's number
  → agent: fetch the agent snapshot by version (signed, cached), start STT/TTS while it rings,
    pickup → line check (person / voicemail / menu)
  → conversation: instructions + "already said" + knowledge (inline if small, else search tool)
    + workflow protocol; `note` tool records typed answers → nextStep() in code → the line to say;
    actions run in code (transfer, text, webhook, book) with results returned to the model;
    end_call with the agent's own outcomes
  → events to the API in batches: answered, transcript (every ~1 s), step, action, ended{data, missing,
    path, outcome}, recording
  → API: file the call, write-backs, follow-ups, enrolment next state, SSE to open screens
  → judge job: success checks, lead, engagement, mood → call; roll-ups updated
Inbound: number → agent lookup (dispatch rule per number) → the same agent runtime;
         unknown callers get a null contact plus the caller's number.
```

**Latency budget per turn:** first audio under 1.2 s. The note step adds about 1.1–1.6 s on answering turns (measured on Forkmate).
- Keep it with: a small fast model and pre-rendered fillers (already in the stack).
- Don't: put a whole-knowledge prompt in the conversation.
- Measure every agent in the sim harness.

---

## 4. Roadmap

Each phase ends with a working, deployed slice and its tests. Phases 1–2 can overlap. Phase 0 is days, not weeks.

### Phase 0: make the prototype safe and honest *(done 2026-11-26)*
- Fix the SSRF (B14): resolve and pin IPs, re-check every redirect, cap streamed bytes, require a session, rate-limit.
- Put Write with AI behind a shared secret or sign-in.
- Fix B1–B3 (storage).
- Fix B4–B10, B18–B24, B28, B30, B34–B35. Add go-live checks for B6–B8. Add confirmations (B26). Add delete and duplicate for agents.
- Move the pure libraries to `packages/core` (no behaviour change; the tests move with them).

**Exit:** all tests pass, plus new tests for every fixed bug; the review deploy can't be abused.

### Phase 1: backend foundation (`apps/api`)
- **Accounts:** NestJS + Mongoose + Redis. Workspaces, users and memberships with roles (owner, admin, member). Email OTP sign-in (copy forktime-core's local OTP pattern). Guards pinned by a test, like forktime-core's `route-guards.spec`.
- **Data model:** the schemas from section 5, all with `workspaceId`, `version` and `deletedAt`.
- **APIs:** CRUD for agents (draft/publish versions), knowledge, contacts (server paging, filtering and sorting on indexed fields), fields, campaigns, numbers (a fake provider adapter until Phase 3).
- **Server-side rules:** every rule from section 2.8, through `packages/core`.
- **Background work:** CSV import as a job (streamed, E.164, de-duplicated against existing contacts, typed values, error report). Knowledge ingestion as a job (fetch with SSRF guard, PDF/Word, chunk + embed).
- **Front end:** the platform moves from localStorage to the API (TanStack Query, optimistic edits, virtualised tables). The sample workspace becomes a seeded demo workspace.

**Exit:** two people can sign in to one workspace and edit safely; 100k contacts page in under 300 ms.

**Progress (2026-11-26): code complete, local, not deployed.**
- Done: accounts, email-code sign-in, workspaces + team roles, every API above, versioned saves (409 `stale` → reloaded), soft delete, server rules through `packages/core`, sample workspace seeded on the server. CSV import as a job with an error report (each left-out or partly read row with its line and reason, downloadable). Knowledge files: PDF (pdf-parse) and Word .docx (mammoth) read by a job, the file deleted after; web pages as before. Knowledge passages (`packages/core` `chunkText`) with search: MongoDB text index + per-word rarity weighting (BM25-style), scoped to what an agent may use; the Knowledge page has "Test a question". The whole front end reads and writes the API. **Exit checked:** two people in one workspace edit the same agent / contact / campaign and the slower save is refused with the newer version (test `auth.test.ts`); 100k contacts: plain 37 ms, filtered 70 ms, sorted ~140 ms. Tests: API 36, core 119, platform 90.
- Changed from the plan: tables are paged on the server (≤200 rows a page), which makes virtualising them unnecessary.
- Waits on the owner: **hosting** (a server for the API and worker, production MongoDB, Redis; then Vercel `API_URL`). Until then the live site runs the old in-browser version.
- Moved to Phase 2: **embeddings** (vector search: Atlas Vector Search if production MongoDB is Atlas, otherwise pgvector; provider and key to pick), since the agent's `search_knowledge` is their first user; the `embedding` field and the search entry point (`common/knowledge-index.ts`) are in place. **BullMQ worker** has only run inline here (no Redis on this machine): run `pnpm worker` against real Redis once at deploy.
- Note for deploy: CSV and file uploads go through the Next rewrite; on Vercel, check large uploads, or send them straight to the API's domain.

### Phase 2: agent runtime (`platform-agent`)
- **Agent base:** fork the lean outreach agent: pickup detection, early audio, line check, runPending, transfer, recording, ordered event emitter.
- **Config:** a signed config fetch by version, modelled on forktime-core's Agent API v1 (HMAC + nonce).
- **Workflow engine:** `note` tool from the data schema + `nextStep()` from `packages/core`. Actions in code. `end_call` with the agent's outcomes. Voicemail policy. Max length and silence. Opt-out → DNC.
- **Knowledge:** inline under a budget, otherwise `search_knowledge`.
- **Events v2:** batched transcripts, structured data, path, actions, cost. The API validates against the agent version's schema.
- **Preview v2:** a real browser voice call into the same agent over LiveKit WebRTC, replacing the browser-speech preview.
- **Testing:**
  - A sim harness that generates scenarios per workflow path (including "all answers at once"), run with the eval key.
  - Every template and every Write with AI result must pass before going live.

**Exit:** a real call to the owner's phone runs a generated agent end to end and files a complete record.

### Phase 3: telephony
- **Provisioning:** Telnyx search, buy and release, with spend caps (copy forktime-core). Regulatory bundles for AU/UK. US texting registration (10DLC) before any US SMS.
- **LiveKit:** a dedicated project. Inbound trunk plus a dispatch rule per number → `platform-agent`. Outbound trunk per country. Caller ID = the agent's number.
- **Inbound routing:** number → agent → version. Unknown callers are handled.
- **Costs:** CDR pull for exact cost per call (copy forktime-core's ledger design, with `dedupeKey`).

**Exit:** buy a number in the app, call it, and the right agent answers; outbound shows the right caller ID.

### Phase 4: campaign engine
- **Core:** enrolments, the scheduler tick, BullMQ dial queue, concurrency slots (workspace / campaign / number), per-contact time zone, legal hours and public holidays per country, retries by outcome, voicemail policy.
- **Follow-ups:** call or text by end state, with caps across campaigns.
- **Triggers:**
  - added;
  - date field (DST-safe, calendar-day maths);
  - field change (contact change log);
  - schedule;
  - re-entry rules.
- **While running:** locked fields, auto-pause with a reason, live progress over SSE.
- **After the call:** write-backs, signed outbound webhooks with retries, CRM log.
- **Compliance:** DNC registers (start with a workspace list plus AU DNCR wash), consent records, an opt-out audit trail.

**Exit:** a 1,000-contact campaign across three time zones runs unattended, respects every window and cap, and survives a worker restart without double-dialling. Proven by a load test with a fake dialer.

### Phase 5: post-call intelligence and analytics
- **Judge job:** success checks with reasons, lead, engagement, mood, with a versioned rubric. Cost per call recorded.
- **Wins:** come from End steps' `success` flag plus checks, not names.
- **Roll-ups:** daily per workspace / agent / campaign / number / region. The Analytics API reads only roll-ups.
- **Best time to call:** in each contact's own zone. Exports run as jobs.

**Exit:** Analytics loads in under 500 ms at 1M calls.

### Phase 6: integrations and tools
- **OAuth connections:** HubSpot, GoHighLevel, Cal.com, Google Calendar first, with encrypted tokens and refresh.
- **Contact sync:** external ids, conflict rules, deletions, a change log feeding "field changes" triggers. CRM write-back and call logging.
- **Book action:** real availability.
- **Agent tools:** MCP servers and API requests with auth, schemas, timeouts and a per-call budget.

### Phase 7: billing, usage and governance
- **Billing:** Stripe plans, credits and minutes (forktime-core's ledger and `CallMinutesService` pattern), number rental, spending caps that pause campaigns.
- **Governance:** audit log, data retention (recordings, transcripts), GDPR delete, recording-consent rules per region, public API keys and signed webhooks.

### Phase 8: hardening and launch
- **Observability:** Sentry, OpenTelemetry → Grafana (copy forktime-core's shared logger, otel and sentry libraries).
- **Load tests:** N concurrent calls, queue backlog, scheduler failover.
- **Operations:** runbooks (silent call, stuck call, carrier outage), a security review, a staged rollout with internal workspaces first.

---

## 5. Data model to build (MongoDB)

| Collection | Key fields | Indexes |
|---|---|---|
| `workspaces` | name, country, timezone, plan, limits | — |
| `users`, `memberships` | email; workspaceId, userId, role | `{workspaceId,userId}` unique |
| `agents` | workspaceId, name, numberId, publishedVersionId, draft (full config), status, deletedAt | `{workspaceId}`, `{numberId}` unique partial |
| `agent_versions` | agentId, n, frozen config (prompt, steps, data schema, knowledge ids, tools, voice, language, tz, call behaviour), publishedAt | `{agentId,n}` unique |
| `numbers` | workspaceId, e164, provider ids, capabilities, status, regulatory, monthly cost | `{e164}` unique |
| `contacts` | workspaceId, name, phoneE164, phoneType, country, timezone, email, fields, lists, consent{}, optedOutAt, externalIds{}, deletedAt | `{workspaceId,phoneE164}` unique partial; `{workspaceId,lists}`; indexed common fields |
| `contact_changes` | contactId, field, from, to, at, source | `{workspaceId,field,at}` |
| `fields` | workspaceId, key, label, type, choices, system | `{workspaceId,key}` unique |
| `dnc` | workspaceId \| global, phoneE164, source, reason, at | `{workspaceId,phoneE164}` unique |
| `knowledge_docs`, `knowledge_chunks` | doc meta, contentHash, refresh; chunk text + embedding | vector index |
| `campaigns` | agentId, audience, trigger, schedule, window, tz policy, retries, voicemail, caps, follow-ups, write-backs, webhooks, status, pausedReason | `{workspaceId,status}` |
| `enrollments` | campaignId, contactId, state, attempt, nextAttemptAt, lastCallId, exitReason, lockedUntil | `{campaignId,contactId}` unique; `{state,nextAttemptAt}` |
| `calls` | workspaceId, agentId, agentVersionId, campaignId, enrollmentId, attempt, direction, from/to/numberId, contactId?, providerCallId, sipCode, answeredBy, timings, recording{key,retentionUntil}, data, missing, path, actions[], checks, lead/engagement/mood, cost | `{workspaceId,startedAt}`, `{campaignId}`, `{contactId,startedAt}` |
| `call_transcripts` | callId, lines[{seq,who,text,at}] | `{callId}` |
| `rollups_daily` | workspaceId, day, dims (agent/campaign/number/region), counters | `{workspaceId,day,dims}` unique |
| `integrations` | workspaceId, provider, credentialsRef (encrypted), scopes, status, lastError | `{workspaceId,provider}` |
| `usage_events`, `audit_events` | cost ledger with dedupeKey; who did what | `{dedupeKey}` unique |

---

## 6. Performance targets

| Area | Target | How |
|---|---|---|
| List endpoints (contacts, calls) | p95 under 200 ms at 100k rows | Server paging, indexes, projections, virtualised tables |
| Analytics | under 500 ms at 1M calls | Roll-ups only, updated per call and nightly |
| Campaign tick | under 1 s for 10k due enrolments | Indexed `{state,nextAttemptAt}`, batched claims, no full scans |
| Agent reply | first audio under 1.2 s; answering turns under 2 s | Small model, fillers, inline knowledge under budget, measured in sims |
| Agent events | 500 concurrent calls | Batched transcripts, one warm process, idempotent writes |
| Editor | no full-workspace re-render | Per-entity queries; the editor holds only its agent |

---

## 7. Owner decisions (2026-11-26)

1. **Database: MongoDB.** Vector search for knowledge is decided in Phase 1: Atlas Vector Search if the cluster is Atlas, otherwise a small pgvector instance.
2. **Repo: inside forktime-outreach.**
3. **Sign-in: our own email OTP** (forktime-core's local OTP pattern).
4. **Countries: Australia and the US at the same time.** Both compliance sets are built in Phase 4 together:
   - AU: DNCR wash, telemarketing hours, public holidays.
   - US: TCPA consent for AI voices, 8 am–9 pm local, federal DNC.
   - US texting needs 10DLC before any SMS.
5. **Data source at launch: CSV import and contacts added by hand, with defined fields.** CRM sync comes later (Phase 6). Campaigns run on whoever is in the list, so every contact carries a consent flag and a do-not-call status, checked before every dial.
6. **A separate LiveKit project: yes.** The owner creates it in the LiveKit Cloud dashboard (the CLI can't), before Phase 2.
7. **Model for calls:** still to confirm. The default is Haiku with low or no thinking, as on the phone agent today.
