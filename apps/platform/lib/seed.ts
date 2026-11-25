// A sample workspace so every page has something real-looking to show.
// Dates are relative to "now" so the automation preview always has upcoming calls.

import { outcomesOf } from "./flow-tree";
import { TEMPLATES, flowFromTemplate } from "./templates";
import type { AppState, Call, Contact, Flow } from "./types";

/** Bump when the sample changes shape, so saved browsers pick up the new one. */
export const SEED_VERSION = 4;

const DAY = 24 * 60 * 60 * 1000;

function isoDay(now: Date, offsetDays: number): string {
  return new Date(now.getTime() + offsetDays * DAY).toISOString().slice(0, 10);
}

export function seedState(now = new Date()): AppState {
  const template = (id: string) => TEMPLATES.find((t) => t.id === id) ?? null;
  const service = { ...flowFromTemplate(template("service_check"), now), id: "f_service", status: "live" as const };
  const lead = { ...flowFromTemplate(template("lead_follow_up"), now), id: "f_lead", status: "live" as const, agent: { name: "Noah", voiceId: "v_noah", personality: "professional" as const, speed: 1.05, language: "English" } };
  const desk = { ...flowFromTemplate(template("front_desk"), now), id: "f_desk", status: "live" as const, agent: { name: "Mia", voiceId: "v_mia", personality: "friendly" as const, speed: 1, language: "English" } };

  const people: [string, string, string, number][] = [
    ["Sarah Chen", "+61412555019", "Corolla Hybrid", -27],
    ["James Wilson", "+61413555022", "RAV4", -12],
    ["Priya Patel", "+61414555031", "Camry", -40],
    ["Tom Nguyen", "+61415555047", "HiLux", -5],
    ["Emma Brown", "+61416555058", "Corolla Hybrid", -31],
    ["Lucas Martin", "+61417555063", "Kluger", -2],
    ["Olivia Taylor", "+61418555074", "Yaris Cross", -19],
    ["Noah Kim", "+61419555085", "RAV4", -60],
  ];
  const contacts: Contact[] = people.map(([name, phone, model, bought], i) => ({
    id: `c_${i + 1}`,
    name,
    phone,
    email: `${name.split(" ")[0].toLowerCase()}@example.com`,
    groups: ["Buyers 2026"],
    fields: { car_model: model, purchase_date: isoDay(now, bought), first_name: name.split(" ")[0] },
    createdAt: isoDay(now, bought),
  }));

  const calls: Call[] = [
    {
      id: "call_1",
      contactId: "c_3",
      flowId: service.id,
      direction: "outbound",
      startedAt: new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString(),
      durationSec: 94,
      outcome: "service_booked",
      summary: "Priya is happy with the Camry and booked her first service for Tuesday 10am.",
      saved: { all_good: "yes", wants_service: "yes" },
      recording: { durationSec: 94 },
      endReason: "agent_ended",
      actions: ["booked", "texted"],
      mood: [0.12, 0.05, 0.08, 0.04],
      transcript: [
        { who: "agent", at: 0.6, text: "Hi Priya, this is Ava, the AI assistant at Northside Motors. This call is recorded. Have you got a minute?" },
        { who: "caller", at: 8.4, text: "Yeah sure, what's up?" },
        { who: "agent", at: 11.2, text: "It's been about a month since you picked up your Camry, so we're checking in. Is everything running well so far?", reason: "Opening the check-in, then the first question in the flow." },
        { who: "caller", at: 20.5, text: "Yeah it's been great actually." },
        { who: "agent", at: 23.1, text: "Love to hear it. Would you like to book your first free service?", reason: "All good is yes, so the flow skips the problem questions." },
        { who: "caller", at: 30.8, text: "Yes, maybe next Tuesday morning?" },
        { who: "action", text: "Checked the service calendar: Tue 10:00, 10:30 and 11:00 free" },
        { who: "agent", at: 36.4, text: "Tuesday at 10am is free. Shall I lock that in?", reason: "Offered the earliest morning slot, as asked." },
        { who: "caller", at: 42.9, text: "Perfect." },
        { who: "action", text: "Booked on the service calendar: Tue 10:00, 1 hour" },
        { who: "action", text: "Texted the booking details to Priya" },
        { who: "agent", at: 46.2, text: "You're all set. We'll text you the details. Thanks!", reason: "Booked, so the flow ends with Service booked." },
      ],
    },
    {
      id: "call_2",
      contactId: "c_8",
      flowId: service.id,
      direction: "outbound",
      startedAt: new Date(now.getTime() - 26 * 60 * 60 * 1000).toISOString(),
      durationSec: 51,
      outcome: "not_now",
      summary: "Noah is fine with the RAV4 but doesn't want a service yet. Follow-up in 3 months.",
      saved: { all_good: "yes", wants_service: "no" },
      recording: { durationSec: 51 },
      endReason: "agent_ended",
      actions: [],
      mood: [0.32, 0.18, 0.41],
      transcript: [
        { who: "agent", at: 0.6, text: "Hi Noah, this is Ava, the AI assistant at Northside Motors. This call is recorded. Have you got a minute?" },
        { who: "caller", at: 7.9, text: "Quickly, yeah." },
        { who: "agent", at: 9.6, text: "Is the RAV4 running well so far?", reason: "He's short on time, so the intro line was skipped." },
        { who: "caller", at: 13.2, text: "All good, no complaints." },
        { who: "agent", at: 15.8, text: "Great. Would you like to book your first free service?" },
        { who: "caller", at: 21.4, text: "Not yet, it's barely done any kilometres." },
        { who: "agent", at: 26.0, text: "No problem at all. We'll check in again in a few months. Have a great day!", reason: "Wants service is no, so the call ends Not now; the automation calls again in 3 months." },
      ],
    },
    {
      id: "call_3",
      contactId: "c_6",
      flowId: desk.id,
      direction: "inbound",
      startedAt: new Date(now.getTime() - 50 * 60 * 1000).toISOString(),
      durationSec: 72,
      outcome: "message_taken",
      summary: "Lucas asked about adding a tow bar to his Kluger. Message passed to the manager.",
      saved: { reason: "Question", wants_person: "no", message: "Wants a quote for a tow bar on his Kluger" },
      recording: { durationSec: 72 },
      endReason: "caller_hung_up",
      actions: ["message", "texted"],
      mood: [0.22, 0.15],
      transcript: [
        { who: "agent", at: 0.4, text: "Thanks for calling Northside Motors, this is Mia, the AI assistant. This call is recorded. How can I help?" },
        { who: "caller", at: 6.8, text: "Hi, I bought a Kluger last week and want to add a tow bar." },
        { who: "agent", at: 12.5, text: "Nice choice. Would you like to speak with someone on the team, or shall I pass on a message?", reason: "A question it can't answer from what it knows, so it offers a person or a message." },
        { who: "caller", at: 20.1, text: "A message is fine, just get someone to quote me." },
        { who: "action", text: "Texted the manager: Lucas wants a quote for a tow bar on his Kluger" },
        { who: "agent", at: 25.7, text: "Got it, someone will get back to you today." },
      ],
    },
  ];

  const live: Call = {
    id: "call_live",
    contactId: "c_2",
    flowId: service.id,
    direction: "outbound",
    startedAt: new Date(now.getTime() - 41 * 1000).toISOString(),
    durationSec: 41,
    outcome: "in_progress",
    summary: "On the call now: checking in on James's RAV4.",
    saved: { all_good: "yes" },
    mood: [0.1, 0.08],
    actions: [],
    transcript: [
      { who: "agent", text: "Hi James, this is Ava, the AI assistant at Northside Motors. This call is recorded. Have you got a minute?" },
      { who: "caller", text: "Yep, go ahead." },
      { who: "agent", text: "It's been about a month since you picked up your RAV4, so we're checking in. Is everything running well so far?" },
      { who: "caller", text: "Yeah, all good." },
    ],
    live: true,
  };

  return {
    version: SEED_VERSION,
    flows: [service, lead, desk],
    automations: [
      {
        id: "a_service",
        name: "One-month service check",
        enabled: true,
        trigger: { kind: "date_field", field: "purchase_date", offsetDays: 30, when: "after" },
        conditions: [],
        flowId: service.id,
        followUps: [{ outcome: "not_now", thenDays: 90 }],
        maxCallsPerWeek: 1,
        updatedAt: now.toISOString(),
      },
      {
        id: "a_lead",
        name: "Call new web leads",
        enabled: false,
        trigger: { kind: "new_contact", group: "Web leads" },
        conditions: [],
        flowId: lead.id,
        followUps: [{ outcome: "needs_decision_maker", thenDays: 2 }],
        maxCallsPerWeek: 2,
        updatedAt: now.toISOString(),
      },
    ],
    contacts,
    fieldDefs: [
      { key: "first_name", label: "First name", type: "text" },
      { key: "car_model", label: "Car model", type: "text" },
      { key: "purchase_date", label: "Purchase date", type: "date" },
    ],
    campaigns: [
      {
        id: "cmp_1",
        name: "Spring service offer",
        flowId: service.id,
        group: "Buyers 2026",
        status: "paused",
        days: [1, 2, 3, 4, 5],
        startHour: 9,
        endHour: 18,
        retries: 2,
        total: 8,
        called: 5,
        answered: 3,
        createdAt: isoDay(now, -6),
      },
    ],
    calls: [live, ...calls, ...sampleHistory(now, [service, lead, desk], contacts)],
    integrations: [
      { id: "hubspot", connected: true, account: "northside-motors.hubspot.com", connectedAt: isoDay(now, -40) },
      { id: "calcom", connected: true, account: "cal.com/northside-service", connectedAt: isoDay(now, -40) },
      { id: "slack", connected: true, account: "#service-desk", connectedAt: isoDay(now, -12) },
    ],
    settings: {
      businessName: "Northside Motors",
      phoneNumber: "+61 2 5550 1234",
      inboundFlowId: desk.id,
      timezone: "Australia/Sydney",
      callingDays: [1, 2, 3, 4, 5, 6],
      callingStart: 9,
      callingEnd: 19,
      doNotCall: [],
    },
  };
}

// ---- Two weeks of earlier calls, for the charts and agent cards ----

const SUMMARIES: Record<string, string> = {
  service_booked: "Happy with the car and booked a first service.",
  not_now: "All fine, no service yet. Follow-up scheduled.",
  meeting_booked: "Qualified and booked a call with sales.",
  needs_decision_maker: "Interested, but someone else decides. Follow-up set.",
  transferred: "Asked for a person and was put through.",
  message_taken: "Left a message for the team.",
};

/** A small, fixed pseudo-random sequence so the sample is the same on every load. */
function sequence(seed: number): () => number {
  let x = seed;
  return () => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return x / 2147483648;
  };
}

function sampleHistory(now: Date, flows: Flow[], contacts: Contact[]): Call[] {
  const rand = sequence(7);
  const calls: Call[] = [];
  for (let day = 13; day >= 1; day--) {
    const weekend = new Date(now.getTime() - day * DAY).getDay() % 6 === 0;
    const count = Math.round((weekend ? 3 : 7) + rand() * 7);
    for (let i = 0; i < count; i++) {
      const flow = flows[Math.floor(rand() * flows.length)];
      const outcomes = outcomesOf(flow);
      const outcome = rand() < 0.14 ? "no_answer" : outcomes[Math.floor(rand() * outcomes.length)];
      const contact = contacts[Math.floor(rand() * contacts.length)];
      const start = new Date(now.getTime() - day * DAY);
      start.setHours(9 + Math.floor(rand() * 9), Math.floor(rand() * 60), 0, 0);
      calls.push({
        id: `call_h${day}_${i}`,
        contactId: contact.id,
        flowId: flow.id,
        direction: flow.direction === "inbound" ? "inbound" : "outbound",
        startedAt: start.toISOString(),
        durationSec: outcome === "no_answer" ? 0 : Math.round(35 + rand() * 180),
        outcome,
        summary: outcome === "no_answer" ? "No answer." : SUMMARIES[outcome] ?? "Call completed.",
        saved: {},
        transcript: [],
        endReason: outcome === "no_answer" ? "no_answer" : outcome === "transferred" ? "transferred" : "agent_ended",
        actions: outcome === "transferred" ? ["transferred"] : /booked|set/.test(outcome) ? ["booked"] : outcome === "message_taken" ? ["message"] : [],
      });
    }
  }
  return calls;
}
