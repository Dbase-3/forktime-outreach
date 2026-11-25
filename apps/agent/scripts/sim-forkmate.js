"use strict";

/**
 * Practice conversations for the Forkmate line (inbound callers we never
 * rang): the real instructions and tools against the real model, in text.
 * Saves are faked here, so nothing reaches the Forktime backend.
 *
 *   pnpm --filter @outreach/agent sim:forkmate            all of them
 *   pnpm --filter @outreach/agent sim:forkmate <name>     one, by name
 *
 * Costs a little model time; uses ANTHROPIC_API_KEY_EVAL when set.
 */

const { VOICE } = require("../src/config");
process.env.AGENT_EVENTS_KEY = process.env.AGENT_EVENTS_KEY || "sim";

const { voice, llm, initializeLogger } = require("@livekit/agents");
const anthropic = require("@livekit/agents-plugin-anthropic");

initializeLogger({ pretty: true, level: "warn" });
const { OutreachCall } = require("../src/call");
const { buildForkmateTools } = require("../src/forkmate/tools");
const { LINES } = require("../src/forkmate/script");

const META = {
  kind: "outreach",
  callId: "sim-forkmate",
  attempt: 1,
  phone: "+61412345678",
  direction: "inbound",
  mode: "forkmate",
  agentName: "Sara",
  recordCalls: true,
  recordingNotice: true,
  maxCallMinutes: 8,
};

/** Each: what the caller says, turn by turn, and what must have happened. */
const SCENARIOS = [
  {
    name: "booking-step-by-step",
    turns: ["Booking for a group.", "It's my mum's 60th birthday.", "New Farm.", "About thirty.", "Saturday the 5th of December.", "Around fifteen hundred.", "Two vegans and a nut allergy.", "Sarah Lee.", "Yes.", "Yes, that's right.", "Yes, that's fine."],
    saves: { kind: "booking", fields: { occasion: "Birthday parties", guests: 30, date: "2026-12-05", budget: 1500, phone: "+61412345678" } },
    ends: "forkmate_booking",
    goodbye: /^Thanks, Sarah\. We'll call you back with options\. Nothing is booked yet\.$/,
    mustAsk: [LINES.booking[0], LINES.booking[2], LINES.booking[3], LINES.booking[4], LINES.booking[6], LINES.booking[7], LINES.bookingConsent],
  },
  {
    name: "booking-all-at-once",
    turns: [
      "Hi, I need somewhere for an office Christmas lunch, 40 people, in the Valley, on Friday the 18th of December. Budget's about three thousand.",
      "No, nothing special.",
      "James Wong.",
      "No, use 0400 111 222.",
      "Yep.",
      "Sure.",
    ],
    saves: { kind: "booking", fields: { guests: 40, date: "2026-12-18", budget: 3000, phone: "0400 111 222" } },
    ends: "forkmate_booking",
    // Already answered: it must not ask these again. Dietary was not answered, so it must be asked.
    neverAsk: [LINES.booking[0], LINES.booking[2], LINES.booking[3], LINES.booking[4]],
    mustAsk: [LINES.booking[5], LINES.booking[6], LINES.bookingConsent],
  },
  {
    name: "booking-no-budget",
    set: "new",
    turns: ["A booking.", "Engagement party.", "Paddington.", "Twenty five.", "The 20th of February.", "Not sure yet, honestly.", "No.", "Priya.", "Yes.", "Correct.", "Yes."],
    saves: { kind: "booking", fields: { occasion: "Weddings & engagements", guests: 25, budget: undefined } },
    ends: "forkmate_booking",
  },
  {
    name: "booking-says-no-to-sharing",
    set: "new",
    turns: ["Group booking.", "Team dinner.", "South Bank.", "Twelve.", "Next Thursday.", "Five hundred.", "No.", "Mark.", "Yes.", "Yes.", "No, I don't want my details shared."],
    noSave: true,
    ends: "other",
  },
  {
    name: "venue-step-by-step",
    turns: ["I want to list my venue.", "The Corner Table.", "Fortitude Valley.", "Sixty.", "Tom Nguyen.", "I'm the owner.", "07 3333 4444.", "We have a private room upstairs.", "Yes, that's fine."],
    saves: { kind: "venue", fields: { venue: "The Corner Table", capacity: 60, role: "owner" } },
    ends: "forkmate_venue",
    goodbye: /^Thanks, Tom\. We'll be in touch about the Brisbane pilot\.$/,
    mustAsk: [LINES.venue[0], LINES.venue[2], LINES.venue[5], LINES.venueConsent],
  },
  {
    name: "venue-this-number-no-role",
    set: "new",
    turns: ["Listing a venue.", "Luigi's Trattoria.", "West End.", "Around eighty.", "Luigi.", "I'd rather not say.", "This number is fine.", "No.", "Yes."],
    saves: { kind: "venue", fields: { capacity: 80, phone: "+61412345678" } },
    ends: "forkmate_venue",
  },
  {
    name: "are-you-ai-mid-call",
    set: "new",
    turns: ["Booking.", "Wait, am I talking to a real person?", "Okay. It's a birthday.", "Bulimba.", "Fifteen.", "The 9th of January.", "Eight hundred.", "No.", "Kate.", "Yes.", "Yes.", "Yes."],
    saves: { kind: "booking" },
    ends: "forkmate_booking",
    mustSay: [/AI assistant/i],
  },
  {
    name: "backend-refuses-date-then-saves",
    set: "new",
    refuseFirst: "That date has already passed. Pick today or a later date.",
    turns: ["Group booking.", "Birthday.", "New Farm.", "Ten.", "The 5th of December.", "Four hundred.", "No.", "Ana.", "Yes.", "Yes.", "Yes.", "Oh sorry, the 12th of December then.", "Yes.", "Yes."],
    saves: { kind: "booking", fields: { date: "2026-12-12" } },
    ends: "forkmate_booking",
  },
  {
    name: "venue-all-at-once",
    set: "new",
    turns: [
      "Hi, I own Bistro Nine in Paddington, we seat about 45, and I'd like to join your network.",
      "Nadia Haddad.",
      "Owner.",
      "0411 222 333.",
      "We do set menus for groups.",
      "Yes.",
    ],
    saves: { kind: "venue", fields: { venue: "Bistro Nine", capacity: 45, phone: "0411 222 333" } },
    ends: "forkmate_venue",
    neverAsk: [LINES.venue[0], LINES.venue[1], LINES.venue[2]],
    mustAsk: [LINES.venue[5], LINES.venueConsent],
  },
  {
    name: "wants-one-restaurant",
    set: "new",
    turns: ["Hi, can I book a table for two at Gerard's Bistro tonight?", "Oh, okay. No, it's just the two of us.", "Bye."],
    noSave: true,
    mustSay: [/best to call them/i],
  },
  {
    name: "booking-mixed-order",
    set: "new",
    turns: ["Hi, I've got 22 people coming on the 14th of March and need somewhere.", "A retirement lunch.", "Woolloongabba.", "Maybe two thousand.", "One coeliac.", "Helen Brooks.", "Yes.", "Yes.", "Yes."],
    saves: { kind: "booking", fields: { guests: 22, budget: 2000, date: "2027-03-14" } },
    ends: "forkmate_booking",
    neverAsk: [LINES.booking[2], LINES.booking[3]],
    mustAsk: [LINES.booking[0], LINES.booking[1], LINES.booking[4], LINES.booking[5]],
  },
  {
    name: "venue-asks-cost",
    set: "new",
    turns: ["Listing a venue.", "How much does this cost me?", "Okay. Harbour Kitchen.", "Bulimba.", "Seventy.", "Grace.", "Manager.", "07 3999 8888.", "No.", "Yes."],
    saves: { kind: "venue", fields: { venue: "Harbour Kitchen", capacity: 70 } },
    ends: "forkmate_venue",
    mustSay: [/team will go through that/i],
    neverSay: [/\$\s?\d|\bfree\b|per (month|booking)/i],
  },
  {
    name: "booking-partial-untuned",
    set: "new",
    turns: ["We're a team of 18 wanting a Christmas party somewhere in Milton.", "The 11th of December.", "About a hundred a head.", "No.", "Rob.", "Yes.", "Yes.", "Yes."],
    saves: { kind: "booking", fields: { guests: 18, date: "2026-12-11" } },
    ends: "forkmate_booking",
    neverAsk: [LINES.booking[0], LINES.booking[1], LINES.booking[2]],
    mustAsk: [LINES.booking[3], LINES.booking[4], LINES.booking[5]],
  },
  {
    name: "venue-partial-untuned",
    set: "new",
    turns: ["Hi, it's Marco from Pasta Bar, I'd like to list it.", "Kangaroo Point.", "Fifty.", "Chef and owner.", "0422 333 444.", "Our terrace.", "Yes."],
    saves: { kind: "venue", fields: { venue: "Pasta Bar", capacity: 50, contactName: "Marco" } },
    ends: "forkmate_venue",
    neverAsk: [LINES.venue[0], LINES.venue[3]],
    mustAsk: [LINES.venue[1], LINES.venue[2], LINES.venue[5]],
  },
  {
    name: "backend-down",
    set: "new",
    unreachable: true,
    turns: ["Booking.", "Private event.", "Teneriffe.", "Fifty.", "The 30th of January.", "Five thousand.", "No.", "Leo.", "Yes.", "Yes.", "Yes."],
    ends: "other",
    summaryHas: [/50|fifty/i, /Teneriffe/i, /Leo/i],
  },
];

/** Filler the owner asked for none of; the script is the words. */
const FILLER = /\b(great|perfect|awesome|wonderful|fantastic|lovely|amazing|absolutely)\b/i;
/** It must never claim a booking is made. */
const NEVER = [/\b(you'?re|you are) (all )?booked\b/i, /\bbooking is confirmed\b/i, /\bI'?ve booked\b/i];
const WORD_LIMIT = 32;
const words = (text) => (text.match(/[\p{L}\p{N}']+/gu) || []).length;
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "");

async function play(scenario) {
  const meta = { ...META, callId: `sim-${scenario.name}` };
  const call = new OutreachCall({ ctx: { room: { name: "sim" } }, meta, vad: null });
  call.emitter = { line: () => undefined, emit: () => undefined };
  const saves = [];
  let refused = false;
  const fakeSave = async (kind, body) => {
    saves.push({ kind, body });
    if (scenario.unreachable) return { saved: false, unreachable: true, reason: "no answer" };
    if (scenario.refuseFirst && !refused) {
      refused = true;
      return { saved: false, unreachable: false, reason: scenario.refuseFirst };
    }
    return { saved: true, reference: "FM-SIM001" };
  };

  const chatCtx = llm.ChatContext.empty();
  chatCtx.addMessage({ role: "assistant", content: call.openingLine });
  // Newer Haiku models refuse a temperature.
  const { temperature, ...llmOptions } = VOICE.llm;
  const model = new anthropic.LLM({ ...llmOptions, ...(/haiku-4/.test(VOICE.llm.model) ? { temperature } : {}), apiKey: process.env.ANTHROPIC_API_KEY_EVAL || process.env.ANTHROPIC_API_KEY });
  const session = new voice.AgentSession({ llm: model, maxToolSteps: VOICE.session.maxToolSteps });
  const replies = [];
  session.on(voice.AgentSessionEventTypes.ConversationItemAdded, ({ item }) => {
    if (item.role === "assistant" && item.textContent) replies.push(item.textContent.trim());
  });
  await session.start({ agent: new voice.Agent({ instructions: call.instructionsFor(), tools: buildForkmateTools(call, { save: fakeSave }), chatCtx }) });

  const log = [`  agent: ${call.openingLine}`];
  // Model time from their words to the agent's reply (text only: no speech-to-text or voice).
  const turnTimes = [];
  for (const turn of scenario.turns) {
    if (call.pending) break;
    const before = replies.length;
    log.push(`  them : ${turn}`);
    const started = Date.now();
    let firstWords = null;
    const onItem = ({ item }) => {
      if (firstWords == null && item.role === "assistant" && item.textContent) firstWords = Date.now() - started;
    };
    session.on(voice.AgentSessionEventTypes.ConversationItemAdded, onItem);
    await session.run({ userInput: turn }).wait();
    session.off(voice.AgentSessionEventTypes.ConversationItemAdded, onItem);
    if (firstWords != null) turnTimes.push(firstWords);
    for (const reply of replies.slice(before)) log.push(`  agent: ${reply}`);
  }
  for (let extra = 0; extra < 2 && !call.pending; extra += 1) {
    const before = replies.length;
    log.push("  them : Okay, thanks. Bye.");
    await session.run({ userInput: "Okay, thanks. Bye." }).wait();
    for (const reply of replies.slice(before)) log.push(`  agent: ${reply}`);
  }
  await session.close().catch(() => undefined);
  const goodbye = call.pending?.type === "end" ? call.pending.goodbye : null;
  if (goodbye) log.push(`  agent: ${goodbye}   (goodbye)`);

  const said = [...replies, goodbye || ""].join("\n");
  const problems = [];
  const lastSave = saves[saves.length - 1];
  if (scenario.noSave && saves.length) problems.push("saved although they said no");
  if (scenario.saves) {
    if (!lastSave) problems.push("never saved");
    else {
      if (lastSave.kind !== scenario.saves.kind) problems.push(`saved a ${lastSave.kind}, wanted a ${scenario.saves.kind}`);
      for (const [field, want] of Object.entries(scenario.saves.fields || {})) {
        const got = lastSave.body[field];
        const same = typeof want === "string" && typeof got === "string" ? norm(got).includes(norm(want)) || norm(want).includes(norm(got)) : got === want;
        if (!same) problems.push(`${field} saved as ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
      }
    }
  }
  if (!call.filed) problems.push("the call was never ended with end_call");
  else if (scenario.ends && call.filed.outcome !== scenario.ends) problems.push(`outcome ${call.filed.outcome}, wanted ${scenario.ends}`);
  if (scenario.goodbye && !(goodbye && scenario.goodbye.test(goodbye.trim()))) problems.push(`goodbye was ${JSON.stringify(goodbye)}`);
  for (const line of scenario.mustAsk || []) if (!said.includes(line)) problems.push(`never asked, word for word: ${line}`);
  for (const line of scenario.neverAsk || []) if (said.includes(line)) problems.push(`asked again: ${line}`);
  for (const pattern of scenario.mustSay || []) if (!pattern.test(said)) problems.push(`never said: ${pattern}`);
  for (const pattern of scenario.neverSay || []) if (pattern.test(said)) problems.push(`said something it must not: ${pattern}`);
  for (const pattern of scenario.summaryHas || []) if (!pattern.test(call.filed?.summary || "")) problems.push(`summary missing ${pattern}`);
  for (const pattern of NEVER) if (pattern.test(said)) problems.push(`said something it must not: ${pattern}`);
  const filler = replies.find((r) => FILLER.test(r));
  if (filler) problems.push(`filler: ${JSON.stringify(filler)}`);
  const longest = Math.max(0, ...replies.map(words));
  if (longest > WORD_LIMIT) problems.push(`a reply ran to ${longest} words`);

  const did = `${saves.length ? `saved ${JSON.stringify(lastSave)}; ` : "saved nothing; "}${call.filed ? `end_call ${JSON.stringify(call.filed)}` : "no end_call"}`;
  const sorted = [...turnTimes].sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  return { name: scenario.name, problems, log, did, longest, median };
}

(async () => {
  const only = process.argv[2];
  const chosen = SCENARIOS.filter((s) => (only ? s.name === only : true));
  let failed = 0;
  for (const scenario of chosen) {
    const result = await play(scenario);
    if (result.problems.length) failed += 1;
    console.log(`\n${result.problems.length ? "FAIL" : "pass"}  ${result.name}   (longest reply ${result.longest} words, median reply ${result.median} ms)`);
    console.log(result.log.join("\n"));
    console.log(`  did  : ${result.did}`);
    for (const problem of result.problems) console.log(`  !! ${problem}`);
  }
  console.log(`\n${chosen.length - failed} of ${chosen.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
