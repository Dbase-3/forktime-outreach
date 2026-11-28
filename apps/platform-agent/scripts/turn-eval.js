// Single-turn checks of the call instructions against the real call model (Haiku 4.5, like the Lisna
// agent), using packages/core/dist (build core first). Each case is a conversation so far plus a judge of
// the next reply: read-backs wait for a yes, a reply to the welcome isn't noted as an answer, weekdays map
// to the right date. Eval key only (ANTHROPIC_API_KEY_EVAL from apps/platform-agent/.env); prints no keys.
// Usage: node apps/platform-agent/scripts/turn-eval.js [runs=4] [label]   (ONLY=<part of a case name> to filter)
// 2026-11-28: before the wording fixes 27/47 replies failed; after, 0/60.
const ROOT = require("path").resolve(__dirname, "../../..");
const fs = require("fs");
const Anthropic = require(`${ROOT}/apps/api/node_modules/@anthropic-ai/sdk`).default;
const core = (m) => require(`${ROOT}/packages/core/dist/${m}.js`);
const { callInstructions } = core("call-instructions");
const { nextStep, lookahead } = core("workflow-run");
const { dataSchema } = core("agent-data");

const env = Object.fromEntries(fs.readFileSync(`${ROOT}/apps/platform-agent/.env`, "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY_EVAL });
const RUNS = Number(process.argv[2] || 4);
const MODEL = "claude-haiku-4-5";

const ask = (id, field, question, answerType = "text") => ({ id, kind: "ask", field, question, answerType });
const TODAY = "Saturday 28 November 2026";

// A: the owner's agent as it should be (Book on Cal.com, saves to CRMs), persona with the read-back rule.
const carAgent = {
  name: "Integrations Test", timezone: "Asia/Karachi", agent: { personality: "friendly", language: "English" },
  greeting: "Hi, this is {agent}, an AI assistant at {business}. This call is recorded. I'd like to help you book a meeting. Is now a good time?",
  prompt: "You are {agent}, the AI assistant at {business}. Your goal is to collect the caller's contact details and book a 30-minute meeting with the team.\n\nTone: friendly, polite and brief.\n\nRules:\n- Ask one question at a time and wait for the answer.\n- Repeat the email and phone number back to check they are right.\n- Only confirm a time after it is actually booked.",
  steps: [ask("s1", "full_name", "Great. First, may I have your full name?"), ask("s2", "email", "Thanks. What is the best email address for you?"), ask("s3", "phone_number", "And what is the best phone number to reach you on?"), { id: "s4", kind: "action", action: "book", detail: "Book a 30-minute meeting", integration: "calcom" }, { id: "s5", kind: "end", outcome: "meeting_booked", text: "Thank you. Have a great day!" }],
  dataFields: [], askRequired: {},
};
// B: a different business (new scenarios): a dental clinic reminder line.
const dentist = {
  name: "Recall", timezone: "Australia/Sydney", agent: { personality: "professional", language: "English" },
  greeting: "Hello, this is {agent}, the AI assistant at {business}. This call is recorded. Do you have a minute?",
  prompt: "You are {agent}, the AI assistant at {business}, a dental clinic. You help patients book their check-up.\n\nRules:\n- Spell back surnames and read back dates of birth to make sure they're right.\n- Never give medical advice.",
  steps: [ask("d1", "surname", "Could I get your surname, please?"), ask("d2", "date_of_birth", "And your date of birth?", "date"), ask("d3", "preferred_day", "Which day suits you for the check-up?", "date"), { id: "d5", kind: "end", outcome: "done", text: "Thanks, we'll be in touch." }],
  dataFields: [], askRequired: {},
};

function setupFor(flow, values, opts = {}) {
  return { flow, business: opts.business ?? "Toyota Motors", direction: "inbound", values: { agent: "Ava", business: opts.business ?? "Toyota Motors", today: opts.today ?? TODAY, ...(opts.values ?? {}), ...values }, schema: dataSchema(flow), knowledge: { inline: [], searchable: false }, test: false, calendar: flow.steps.some((s) => s.integration === "calcom") ? { provider: "calcom", name: "Cal.com" } : null };
}
function instructionsFor(flow, saved, opts) {
  const done = new Set(flow.steps.filter((s) => s.kind === "ask" && saved[s.field]).map((s) => s.id));
  const setup = setupFor(flow, {}, opts);
  const pos = nextStep(flow.steps, saved, done);
  return callInstructions(setup, pos, lookahead(flow.steps, saved, done, pos), new Date(opts?.now ?? "2026-11-28T06:00:00Z"));
}
const tools = (flow) => [
  { name: "note", description: "Save something they actually said: the answer to the current question, a later question answered early, a changed answer, or something to listen for. Never save a question you are asking. The result says what to say next, unless you've already said it (see Right now).", input_schema: { type: "object", properties: { field: { type: "string", enum: dataSchema(flow).map((f) => f.key) }, value: { type: "string" } }, required: ["field", "value"] } },
  { name: "end_call", description: "End the call when it can't go on.", input_schema: { type: "object", properties: { goodbye: { type: "string" }, outcome: { type: "string" }, summary: { type: "string" } }, required: ["goodbye", "outcome", "summary"] } },
  ...(flow.steps.some((s) => s.integration) ? [
    { name: "check_times", description: "Get free times.", input_schema: { type: "object", properties: { from: { type: "string" } } } },
    { name: "book_time", description: "Book the time they picked. Only after they've agreed to a day and time from check_times.", input_schema: { type: "object", properties: { start: { type: "string" }, name: { type: "string" } }, required: ["start", "name"] } },
  ] : []),
];

// Each case: the conversation so far (last line = caller), and a judge of the reply.
const notes = (r) => r.content.filter((b) => b.type === "tool_use" && b.name === "note").map((b) => b.input);
const text = (r) => r.content.filter((b) => b.type === "text").map((b) => b.text).join(" ");
const plumber = {
  name: "Callback", timezone: "America/New_York", agent: { personality: "friendly", language: "English" },
  greeting: "Hi, this is {agent}, the AI assistant at {business}. This call is recorded. How can I help?",
  prompt: "You are {agent}, the AI assistant at {business}, a plumbing company. You take callback requests.\n\nRules:\n- Always read the phone number back to the caller, digit by digit, and ask if it's right.\n- Always repeat the address back to check it.",
  steps: [ask("p1", "issue", "What's going on with the plumbing?"), ask("p2", "callback_number", "What's the best number to call you back on?"), ask("p3", "address", "And the address for the job?"), { id: "p5", kind: "end", outcome: "callback_requested", text: "Thanks, a plumber will call you back shortly." }],
  dataFields: [], askRequired: {},
};
const seoAgent = {
  name: "Sunny Comet", timezone: "Asia/Karachi", agent: { personality: "friendly", language: "English" },
  greeting: "Hi {first_name}, this is {agent}, an AI assistant calling from {business}. This call is recorded. Do you have a quick minute?",
  prompt: "You are {agent}, an AI assistant calling restaurant owners for {business}, a digital marketing agency. Keep it short and friendly.",
  steps: [ask("q1", "interest", "Which are you most interested in: SEO, online ads, or directory listings?"), ask("q2", "contact_name", "Can I take your name?"), ask("q3", "contact_phone", "And what's the best phone number to reach you on?"), { id: "q4", kind: "action", action: "book", detail: "Book a 30-minute call", integration: "calcom" }, { id: "q5", kind: "end", outcome: "meeting_booked", text: "Thanks, speak then!" }],
  dataFields: [], askRequired: {},
};
const SLOTS = "Free times in Karachi time:\nMonday 30 November: 9 am [2026-11-30T04:00:00Z], 10:30 am [2026-11-30T05:30:00Z], 4 pm [2026-11-30T11:00:00Z]\nTuesday 1 December: 10:30 am [2026-12-01T05:30:00Z], 2 pm [2026-12-01T09:00:00Z]";
const ONLY = process.env.ONLY;
const CASES = [
  { name: "name: you know my name (owner's call)", flow: seoAgent, saved: { interest: "SEO" }, opts: { business: "Digital Growth Co", values: { name: "Aadeel Khaan", first_name: "Aadeel", phone: "+14045090399" } },
    convo: [["a", "Hi Aadeel, this is Ava, an AI assistant calling from Digital Growth Co. This call is recorded. Do you have a quick minute?"], ["u", "Yes."], ["a", "Which are you most interested in: SEO, online ads, or directory listings?"], ["u", "SEO."], ["a", "Great choice. Can I take your name?"], ["u", "You already know my name."]],
    pass: (r) => { const n = notes(r).find((x) => x.field === "contact_name"); return n ? (/aadeel/i.test(n.value) ? "ok" : `FAIL noted "${n.value}"`) : `FAIL no name noted: "${text(r).slice(0, 70)}"`; } },
  { name: "name: it's on your list (new)", flow: seoAgent, saved: { interest: "Online ads" }, opts: { business: "Digital Growth Co", values: { name: "Maria Lopez", first_name: "Maria", phone: "+15125550198" } },
    convo: [["a", "Hi Maria, this is Ava, an AI assistant calling from Digital Growth Co. This call is recorded. Do you have a quick minute?"], ["u", "Sure."], ["a", "Which are you most interested in: SEO, online ads, or directory listings?"], ["u", "Online ads I guess."], ["a", "Nice. Can I take your name?"], ["u", "You called me, you've got it already."]],
    pass: (r) => { const n = notes(r).find((x) => x.field === "contact_name"); return n ? (/maria/i.test(n.value) ? "ok" : `FAIL noted "${n.value}"`) : `FAIL no name noted: "${text(r).slice(0, 70)}"`; } },
  { name: "book: unclear pick isn't booked (owner's call)", flow: seoAgent, saved: { interest: "SEO", contact_name: "Aadeel Khaan", contact_phone: "+923131083726" }, opts: { business: "Digital Growth Co" },
    convo: [["a", "Got it. Let me check what's free."], ["tool", { id: "t1", name: "check_times", input: {} }], ["result", { id: "t1", text: SLOTS }], ["a", "I've got Monday at 9 am, 10:30 am or 4 pm. Which suits?"], ["u", "Let's do Monday at 4:30 AM."], ["a", "4:30 am is early, and it's not free. I've got 4 pm on Monday, would that work?"], ["u", "PM. Sorry, PM."]],
    pass: (r) => r.content.some((b) => b.type === "tool_use" && b.name === "book_time") ? `FAIL booked: "${text(r).slice(0, 70)}"` : "ok" },
  { name: "book: clear yes is booked (new)", flow: seoAgent, saved: { interest: "SEO", contact_name: "Maria Lopez", contact_phone: "+15125550198" }, opts: { business: "Digital Growth Co" },
    convo: [["a", "Can I take your name?"], ["u", "Maria Lopez."], ["a", "Thanks Maria. And the best number to reach you on?"], ["u", "512 555 0198."], ["a", "Got it. Let me check what's free."], ["tool", { id: "t1", name: "check_times", input: {} }], ["result", { id: "t1", text: SLOTS }], ["a", "I've got Tuesday at 10:30 am or 2 pm. Which suits?"], ["u", "2 pm Tuesday."], ["a", "So that's Tuesday the 1st of December at 2 pm. Shall I book it?"], ["u", "Yes please."]],
    pass: (r) => { const b = r.content.find((x) => x.type === "tool_use" && x.name === "book_time"); return b ? (b.input.start === "2026-12-01T09:00:00Z" ? "ok" : `FAIL booked ${b.input.start}`) : `FAIL not booked: "${text(r).slice(0, 70)}"`; } },
  { name: "book: picks a free time (new)", flow: seoAgent, saved: { interest: "SEO", contact_name: "Maria Lopez", contact_phone: "+15125550198" }, opts: { business: "Digital Growth Co" },
    convo: [["a", "Can I take your name?"], ["u", "Maria Lopez."], ["a", "Thanks Maria. And the best number to reach you on?"], ["u", "512 555 0198."], ["a", "Got it. Let me check what's free."], ["tool", { id: "t1", name: "check_times", input: {} }], ["result", { id: "t1", text: SLOTS }], ["a", "I've got Monday at 9 am or 10:30 am, or Tuesday at 2 pm. Which suits?"], ["u", "Monday at 10:30."]],
    pass: (r) => r.content.some((b) => b.type === "tool_use" && b.name === "book_time") ? `FAIL booked without a yes: "${text(r).slice(0, 70)}"` : /10:30/.test(text(r)) ? "ok (repeated, waiting)" : `? "${text(r).slice(0, 70)}"` },
  { name: "readback forced: confirmed (new, plumber)", flow: plumber, saved: { issue: "Leaking pipe" }, opts: { business: "Ace Plumbing", today: "Monday 30 November 2026", now: "2026-11-30T15:00:00Z" },
    convo: [["a", "Hi, this is Ava, the AI assistant at Ace Plumbing. This call is recorded. How can I help?"], ["u", "My kitchen sink pipe is leaking."], ["a", "Sorry to hear that. What's the best number to call you back on?"], ["u", "It's 212 555 0147."], ["a", "Thanks. Let me read that back: two one two, five five five, zero one four seven. Is that right?"], ["u", "Yes, that's right."]],
    pass: (r) => notes(r).some((n) => n.field === "callback_number") ? (/address/i.test(text(r)) || !text(r).trim() ? "ok (noted, moved on)" : `ok (noted) "${text(r).slice(0, 60)}"`) : `FAIL didn't note after yes: "${text(r).slice(0, 80)}"` },
  { name: "readback forced: number (new, plumber)", flow: plumber, saved: { issue: "Leaking pipe under the sink" }, opts: { business: "Ace Plumbing", today: "Monday 30 November 2026", now: "2026-11-30T15:00:00Z" },
    convo: [["a", "Hi, this is Ava, the AI assistant at Ace Plumbing. This call is recorded. How can I help?"], ["u", "My kitchen sink pipe is leaking."], ["a", "Sorry to hear that. What's the best number to call you back on?"], ["u", "It's 212 555 0147."]],
    pass: (r) => /\?/.test(text(r)) && /right|correct/i.test(text(r)) ? (notes(r).length ? "FAIL read back AND noted" : "ok (read back, waited)") : notes(r).length ? "ok (noted, no read-back)" : `? "${text(r).slice(0, 80)}"` },
  { name: "readback forced: address (new, plumber)", flow: plumber, saved: { issue: "Burst pipe", callback_number: "+12125550147" }, opts: { business: "Ace Plumbing", today: "Monday 30 November 2026", now: "2026-11-30T15:00:00Z" },
    convo: [["a", "Hi, this is Ava, the AI assistant at Ace Plumbing. This call is recorded. How can I help?"], ["u", "A pipe burst in the basement."], ["a", "Oh no. What's the best number to call you back on?"], ["u", "212 555 0147."], ["a", "Thanks. And the address for the job?"], ["u", "48 Willow Street, Brooklyn."]],
    pass: (r) => /\?/.test(text(r)) && /right|correct/i.test(text(r)) ? (notes(r).length ? "FAIL read back AND noted" : "ok (read back, waited)") : notes(r).length ? "ok (noted, no read-back)" : `? "${text(r).slice(0, 80)}"` },
  { name: "readback: phone (owner's call)", flow: carAgent, saved: { full_name: "Kevin Peterson", email: "kevin@gmail.com" },
    convo: [["a", "Hi, this is Ava, an AI assistant at Toyota Motors. This call is recorded. I'd like to help you book a meeting. Is now a good time?"], ["u", "Yes sure."], ["a", "Great. First, may I have your full name?"], ["u", "Kevin Peterson."], ["a", "Thanks, Kevin. What is the best email address for you?"], ["u", "kevin at gmail dot com"], ["a", "Got it. And what is the best phone number to reach you on?"], ["u", "Plus 92 313 108 3726."]],
    pass: (r) => /\?/.test(text(r)) && notes(r).length === 0 ? "ok (read back, waited)" : notes(r).length === 0 ? "ok (no note)" : /correct|right\?|that right/i.test(text(r)) ? "FAIL noted during read-back" : "ok (noted, no read-back)" },
  { name: "readback: email (new)", flow: carAgent, saved: { full_name: "Sana Malik" },
    convo: [["a", "Hi, this is Ava, an AI assistant at Toyota Motors. This call is recorded. I'd like to help you book a meeting. Is now a good time?"], ["u", "Go ahead."], ["a", "Great. First, may I have your full name?"], ["u", "Sana Malik."], ["a", "Thanks, Sana. What is the best email address for you?"], ["u", "it's sana dot malik at outlook dot com"]],
    pass: (r) => notes(r).length && /correct|right\?|that right/i.test(text(r)) ? "FAIL noted during read-back" : "ok" },
  { name: "readback: surname spelled (new, dentist)", flow: dentist, saved: {}, opts: { business: "Bright Smiles Dental", today: "Monday 30 November 2026", now: "2026-11-30T03:00:00Z" },
    convo: [["a", "Hello, this is Ava, the AI assistant at Bright Smiles Dental. This call is recorded. Do you have a minute?"], ["u", "Yes."], ["a", "Could I get your surname, please?"], ["u", "It's Nguyen."]],
    pass: (r) => notes(r).length && /spell|correct|right\?/i.test(text(r)) ? "FAIL noted during read-back" : notes(r).length ? "ok (noted, no read-back)" : "ok (read back, waited)" },
  { name: "welcome question answered (owner's call)", flow: carAgent, saved: {},
    convo: [["a", "Hi, this is Ava, an AI assistant at Toyota Motors. This call is recorded. I'd like to help you book a meeting. Is now a good time?"], ["u", "It's a good time, but a meeting for what?"]],
    pass: (r) => notes(r).some((n) => n.field === "full_name") ? `FAIL noted name "${notes(r).find((n) => n.field === "full_name").value}"` : "ok" },
  { name: "welcome question answered (new, dentist)", flow: dentist, saved: {}, opts: { business: "Bright Smiles Dental", today: "Monday 30 November 2026", now: "2026-11-30T03:00:00Z" },
    convo: [["a", "Hello, this is Ava, the AI assistant at Bright Smiles Dental. This call is recorded. Do you have a minute?"], ["u", "Yeah, I've got a minute."]],
    pass: (r) => notes(r).some((n) => n.field === "surname") ? `FAIL noted surname "${notes(r).find((n) => n.field === "surname").value}"` : "ok" },
  { name: "date: next Monday (Sat 28 Nov)", flow: dentist, saved: { surname: "Nguyen", date_of_birth: "1990-04-02" }, opts: { business: "Bright Smiles Dental", today: "Saturday 28 November 2026", now: "2026-11-28T06:00:00Z" },
    convo: [["a", "Hello, this is Ava, the AI assistant at Bright Smiles Dental. This call is recorded. Do you have a minute?"], ["u", "Sure."], ["a", "Could I get your surname, please?"], ["u", "Nguyen, N G U Y E N."], ["a", "And your date of birth?"], ["u", "Second of April 1990."], ["a", "Which day suits you for the check-up?"], ["u", "Next Monday please."]],
    pass: (r) => { const n = notes(r).find((x) => x.field === "preferred_day"); const t = text(r); return n ? (n.value === "2026-11-30" ? "ok" : `FAIL noted ${n.value}`) : /december 1|1 december|first of december/i.test(t) ? "FAIL said Dec 1" : /30/.test(t) ? "ok (said 30th)" : `? "${t.slice(0, 80)}"`; } },
  { name: "date: this Friday (new, Tue 1 Dec)", flow: dentist, saved: { surname: "Ali", date_of_birth: "1985-07-09" }, opts: { business: "Bright Smiles Dental", today: "Tuesday 1 December 2026", now: "2026-12-01T03:00:00Z" },
    convo: [["a", "Hello, this is Ava, the AI assistant at Bright Smiles Dental. This call is recorded. Do you have a minute?"], ["u", "Yes."], ["a", "Could I get your surname, please?"], ["u", "Ali."], ["a", "And your date of birth?"], ["u", "Ninth of July 1985."], ["a", "Which day suits you for the check-up?"], ["u", "This Friday works."]],
    pass: (r) => { const n = notes(r).find((x) => x.field === "preferred_day"); const t = text(r); return n ? (n.value === "2026-12-04" ? "ok" : `FAIL noted ${n.value}`) : /4|fourth/i.test(t) ? "ok (said 4th)" : `? "${t.slice(0, 80)}"`; } },
];

(async () => {
  const label = process.argv[3] || "";
  let fails = 0, total = 0;
  for (const c of CASES.filter((c) => !ONLY || c.name.includes(ONLY))) {
    const system = instructionsFor(c.flow, c.saved, c.opts);
    const messages = c.convo.map(([w, t]) => ({ role: w === "a" || w === "tool" ? "assistant" : w === "result" ? "user" : "user", content: w === "tool" ? [{ type: "tool_use", id: t.id, name: t.name, input: t.input }] : w === "result" ? [{ type: "tool_result", tool_use_id: t.id, content: t.text }] : t }));
    const out = [];
    for (let i = 0; i < RUNS; i++) {
      const r = await client.messages.create({ model: MODEL, max_tokens: 300, system, tools: tools(c.flow), messages });
      const v = c.pass(r);
      total++; if (v.startsWith("FAIL")) fails++;
      out.push(v + (v.startsWith("FAIL") ? ` | said: "${text(r).slice(0, 90)}" notes=${JSON.stringify(notes(r))}` : ""));
    }
    console.log(`\n${c.name}`); out.forEach((o) => console.log(`   ${o}`));
  }
  console.log(`\n${label} FAILS: ${fails}/${total}`);
})();
