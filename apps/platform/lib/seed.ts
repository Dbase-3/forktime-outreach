// A sample workspace so every page has something real-looking to show.
// Dates are relative to "now" so the automation preview always has upcoming calls.

import { defaultCampaign } from "./campaign";
import { outcomesOf } from "./flow-tree";
import { TEMPLATES, flowFromTemplate } from "./templates";
import type { AppState, Call, Contact, Flow } from "./types";

/** Bump when the sample changes shape, so saved browsers pick up the new one. */
export const SEED_VERSION = 12;

const DAY = 24 * 60 * 60 * 1000;

function isoDay(now: Date, offsetDays: number): string {
  return new Date(now.getTime() + offsetDays * DAY).toISOString().slice(0, 10);
}

export function seedState(now = new Date()): AppState {
  const template = (id: string) => TEMPLATES.find((t) => t.id === id) ?? null;
  const service = {
    ...flowFromTemplate(template("service_check"), now, "Australia/Sydney"),
    id: "f_service",
    status: "live" as const,
    knowledgeIds: ["k_service"],
    askRequired: { problem: false },
    dataFields: [
      { key: "callback_time", label: "Callback time", type: "text" as const, description: "When they'd like us to call back, if they mention it", required: false, fallback: "Anytime" },
      { key: "km_now", label: "Kilometres now", type: "number" as const, description: "The car's kilometres, if they say", required: false },
    ],
    checks: [
      { id: "chk_booked", label: "Booked or set a follow-up", description: "Passed when a service was booked or they asked to be called later" },
      { id: "chk_happy", label: "Customer is happy", description: "Passed when they say the car is running well" },
    ],
  };
  const lead = { ...flowFromTemplate(template("lead_follow_up"), now, "Australia/Sydney"), id: "f_lead", status: "live" as const, agent: { name: "Noah", voiceId: "v_noah", personality: "professional" as const, speed: 1.05, language: "English" } };
  const desk = { ...flowFromTemplate(template("front_desk"), now, "Australia/Sydney"), id: "f_desk", status: "live" as const, knowledgeIds: ["k_service", "k_warranty"], agent: { name: "Mia", voiceId: "v_mia", personality: "friendly" as const, speed: 1, language: "English" } };

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
  const MODELS = ["Corolla Hybrid", "RAV4", "Camry", "HiLux", "Kluger", "Yaris Cross", "LandCruiser", "C-HR"];
  const TIERS = ["Standard", "Gold", "Platinum"];
  const SUBURBS = ["Northside", "Riverview", "Hillcrest", "Bayside", "Oakwood"];
  const contactFor = (name: string, phone: string, model: string, bought: number, i: number): Contact => ({
    id: `c_${i + 1}`,
    name,
    phone,
    email: i % 7 === 5 ? undefined : `${name.split(" ")[0].toLowerCase()}.${name.split(" ")[1]?.toLowerCase() ?? "x"}@example.com`,
    groups: ["Buyers 2026"],
    fields: {
      first_name: name.split(" ")[0],
      car_model: model,
      purchase_date: isoDay(now, bought),
      km: String(Math.max(150, Math.round(-bought * 46 + (i % 5) * 310))),
      tier: TIERS[i % 3],
      service_plan: i % 3 === 0 ? "Yes" : "No",
      suburb: SUBURBS[i % 5],
    },
    sourceId: "src_hubspot",
    createdAt: isoDay(now, bought),
  });
  const FIRST = ["Mia", "Leo", "Ava", "Jack", "Zoe", "Ethan", "Ruby", "Oscar", "Isla", "Henry", "Chloe", "Max", "Grace", "Liam", "Lily", "Noah", "Ella", "Lucas", "Amelia", "Mason", "Harper", "Logan", "Aria", "Ryan", "Sofia", "Kai", "Layla", "Ari", "Nina", "Theo", "Maya", "Ben"];
  const LAST = ["Smith", "Brown", "Singh", "Lee", "Martin", "Walker", "Hall", "Young", "King", "Wright", "Green", "Baker", "Adams", "Clark", "Ali", "Khan"];
  const contacts: Contact[] = [
    ...people.map(([name, phone, model, bought], i) => contactFor(name, phone, model, bought, i)),
    ...FIRST.map((first, j) => {
      const i = people.length + j;
      return contactFor(`${first} ${LAST[j % LAST.length]}`, j % 6 === 4 ? `+6421${String(100000 + j * 7919).slice(0, 6)}` : `+6142${String(1000000 + j * 7919).slice(0, 7)}`, MODELS[j % MODELS.length], -((j * 11) % 150) - 3, i);
    }),
  ];
  // The last few came in through the website's form, not the CRM.
  contacts.slice(-6).forEach((c) => {
    c.groups = ["Web leads"];
    c.sourceId = "src_web";
    c.fields = { first_name: c.fields.first_name, suburb: c.fields.suburb };
  });

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
      checkResults: { chk_booked: "success", chk_happy: "success" },
      transcript: [
        { who: "agent", at: 0.6, text: "Hi Priya, this is Ava, the AI assistant at Northside Motors. This call is recorded. Have you got a minute?" },
        { who: "caller", at: 8.4, text: "Yeah sure, what's up?" },
        { who: "agent", at: 11.2, text: "It's been about a month since you picked up your Camry, so we're checking in. Is everything running well so far?", reason: "Opening the check-in, then the first question in the workflow." },
        { who: "caller", at: 20.5, text: "Yeah it's been great actually." },
        { who: "agent", at: 23.1, text: "Love to hear it. Would you like to book your first free service?", reason: "All good is yes, so the workflow skips the problem questions." },
        { who: "caller", at: 30.8, text: "Yes, maybe next Tuesday morning?" },
        { who: "action", text: "Checked the service calendar: Tue 10:00, 10:30 and 11:00 free" },
        { who: "agent", at: 36.4, text: "Tuesday at 10am is free. Shall I lock that in?", reason: "Offered the earliest morning slot, as asked." },
        { who: "caller", at: 42.9, text: "Perfect." },
        { who: "action", text: "Booked on the service calendar: Tue 10:00, 1 hour" },
        { who: "action", text: "Texted the booking details to Priya" },
        { who: "agent", at: 46.2, text: "You're all set. We'll text you the details. Thanks!", reason: "Booked, so the call ends with Service booked." },
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
      checkResults: { chk_booked: "success", chk_happy: "success" },
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
    knowledge: [
      {
        id: "k_hours",
        name: "Opening hours & location",
        kind: "text",
        content: "Showroom: Monday to Friday 9am to 6pm, Saturday 9am to 1pm, closed Sunday.\nService centre: Monday to Friday 7:30am to 5pm.\nWe're at 12 Main Street, Northside. Customer parking at the back.",
        sizeBytes: 196,
        status: "ready",
        availableToAll: true,
        createdAt: isoDay(now, -40),
        updatedAt: isoDay(now, -3),
      },
      {
        id: "k_service",
        name: "Service menu & prices",
        kind: "url",
        source: "https://northside-motors.example/service",
        content: "First service: free within 6 months or 10,000 km.\nStandard service: $249 (oil, filter, 40-point check).\nMajor service: $449 (adds brake fluid, coolant, spark plugs).\nLoan cars available on request, book 2 days ahead.",
        sizeBytes: 2410,
        pages: 1,
        status: "ready",
        availableToAll: false,
        autoRefresh: true,
        createdAt: isoDay(now, -30),
        updatedAt: isoDay(now, -1),
      },
      {
        id: "k_warranty",
        name: "Warranty terms.pdf",
        kind: "file",
        source: "Warranty terms.pdf",
        content: "",
        sizeBytes: 418_000,
        status: "waiting",
        availableToAll: false,
        createdAt: isoDay(now, -8),
        updatedAt: isoDay(now, -8),
      },
    ],
    contacts,
    fieldDefs: [
      { key: "first_name", label: "First name", type: "text", source: "src_hubspot" },
      { key: "car_model", label: "Car model", type: "text", source: "src_hubspot" },
      { key: "purchase_date", label: "Purchase date", type: "date", source: "src_hubspot" },
      { key: "km", label: "Kilometres", type: "number", source: "src_hubspot" },
      { key: "tier", label: "Tier", type: "choice", choices: ["Standard", "Gold", "Platinum"], source: "src_hubspot" },
      { key: "service_plan", label: "Service plan", type: "yesno", source: "src_hubspot" },
      { key: "suburb", label: "Suburb", type: "text", source: "src_hubspot" },
      { key: "wants_service", label: "Wants service", type: "yesno", source: "call" },
    ],
    sources: [
      { id: "src_hubspot", kind: "sync", integrationId: "hubspot", name: "HubSpot · Contacts", object: "Contacts", list: "Buyers 2026", fieldKeys: ["first_name", "car_model", "purchase_date", "km", "tier", "service_plan", "suburb"], rows: 34, syncEvery: "15m", lastSyncAt: new Date(now.getTime() - 6 * 60 * 1000).toISOString(), status: "synced" },
      { id: "src_web", kind: "csv", name: "web-leads-nov.csv", list: "Web leads", fieldKeys: ["first_name", "suburb"], rows: 6, lastSyncAt: isoDay(now, -2), status: "synced" },
    ],
    campaigns: [
      {
        ...defaultCampaign(service.id, now),
        id: "cmp_service",
        name: "One-month service check",
        status: "running",
        mode: "always",
        audience: { list: "Buyers 2026", filter: { match: "all", rules: [] } },
        trigger: { kind: "date_field", field: "purchase_date", offsetDays: 30, when: "after" },
        days: [1, 2, 3, 4, 5, 6],
        startHour: 9,
        endHour: 19,
        followUps: [{ id: "fu_1", outcome: "not_now", action: "call", afterDays: 90 }],
        writeBacks: [{ from: "wants_service", to: "wants_service" }],
        logTo: ["hubspot", "slack"],
        called: 41,
        answered: 33,
        createdAt: isoDay(now, -30),
      },
      {
        ...defaultCampaign(lead.id, now),
        id: "cmp_leads",
        name: "Call new web leads",
        status: "paused",
        mode: "always",
        audience: { list: "Web leads", filter: { match: "all", rules: [] } },
        trigger: { kind: "added" },
        days: [0, 1, 2, 3, 4, 5, 6],
        startHour: 8,
        endHour: 20,
        concurrent: 3,
        followUps: [{ id: "fu_2", outcome: "needs_decision_maker", action: "call", afterDays: 2 }],
        logTo: ["hubspot"],
        called: 12,
        answered: 9,
        createdAt: isoDay(now, -12),
      },
      {
        ...defaultCampaign(service.id, now),
        id: "cmp_spring",
        name: "Spring service offer",
        status: "running",
        mode: "once",
        audience: { list: "Buyers 2026", filter: { match: "all", rules: [{ field: "tier", op: "any_of", value: "Gold, Platinum" }] } },
        called: 14,
        answered: 10,
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
