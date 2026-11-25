// Starter flows. Picking one copies it with fresh ids; the customer edits the copy.

import { newId } from "./flow-tree";
import type { AgentVoice, Direction, Flow, Step } from "./types";

export interface FlowTemplate {
  id: string;
  name: string;
  blurb: string;
  direction: Direction;
  category: "Sales" | "Service" | "Front desk" | "Billing";
  build: () => Pick<Flow, "greeting" | "steps">;
}

const say = (text: string): Step => ({ id: newId(), kind: "say", text });
const yesno = (question: string, field: string): Step => ({ id: newId(), kind: "ask", question, field, answerType: "yesno" });
const text = (question: string, field: string): Step => ({ id: newId(), kind: "ask", question, field, answerType: "text" });
const date = (question: string, field: string): Step => ({ id: newId(), kind: "ask", question, field, answerType: "date" });
const choice = (question: string, field: string, choices: string[]): Step => ({ id: newId(), kind: "ask", question, field, answerType: "choice", choices });
const ifYes = (field: string, yes: Step[], no: Step[]): Step => ({ id: newId(), kind: "branch", condition: { field, op: "is_yes" }, yes, no });
const book = (detail: string): Step => ({ id: newId(), kind: "action", action: "book", detail });
const transfer = (detail: string): Step => ({ id: newId(), kind: "action", action: "transfer", detail });
const textMsg = (detail: string): Step => ({ id: newId(), kind: "action", action: "text", detail });
const crm = (detail: string): Step => ({ id: newId(), kind: "action", action: "crm", detail });
const end = (outcome: string, line: string): Step => ({ id: newId(), kind: "end", outcome, text: line });

export const TEMPLATES: FlowTemplate[] = [
  {
    id: "service_check",
    name: "Service check-in",
    blurb: "Calls a customer after a purchase, checks all is well and books a service.",
    direction: "outbound",
    category: "Service",
    build: () => ({
      greeting: "Hi {first_name}, this is {agent}, the AI assistant at {business}. This call is recorded. Have you got a minute?",
      steps: [
        say("It's been about a month since you picked up your {car_model}, so we're checking in."),
        yesno("Is everything running well so far?", "all_good"),
        ifYes("all_good", [], [text("Sorry to hear that. What's been happening?", "problem"), crm("Flag the problem for the service team")]),
        yesno("Would you like to book your first free service?", "wants_service"),
        ifYes(
          "wants_service",
          [book("Service bay calendar, 1 hour slots"), end("service_booked", "You're all set. We'll text you the details. Thanks!")],
          [end("not_now", "No problem at all. We'll check in again in a few months. Have a great day!")],
        ),
      ],
    }),
  },
  {
    id: "lead_follow_up",
    name: "New lead follow-up",
    blurb: "Rings a new enquiry within a minute, qualifies it and books a meeting.",
    direction: "outbound",
    category: "Sales",
    build: () => ({
      greeting: "Hi {first_name}, it's {agent}, the AI assistant at {business}. This call is recorded. You just asked about us online, is now a good time?",
      steps: [
        text("What made you reach out today?", "need"),
        choice("When are you hoping to get started?", "timeline", ["This month", "In 1 to 3 months", "Just looking"]),
        yesno("Are you the person who makes the decision on this?", "decision_maker"),
        ifYes(
          "decision_maker",
          [book("Sales team calendar, 30 minute call"), end("meeting_booked", "Perfect, you'll get an invite shortly. Talk soon!")],
          [text("Who else should be on the call?", "other_contact"), end("needs_decision_maker", "Thanks, we'll reach out to set a time with you both.")],
        ),
      ],
    }),
  },
  {
    id: "front_desk",
    name: "Front desk",
    blurb: "Answers calls, handles common questions and takes a message.",
    direction: "inbound",
    category: "Front desk",
    build: () => ({
      greeting: "Thanks for calling {business}, this is {agent}, the AI assistant. This call is recorded. How can I help?",
      steps: [
        choice("Is this about a booking, a question, or something else?", "reason", ["Booking", "Question", "Something else"]),
        yesno("Would you like to speak with someone on the team?", "wants_person"),
        ifYes(
          "wants_person",
          [transfer("Front desk line"), end("transferred", "Putting you through now.")],
          [text("What message should I pass on?", "message"), textMsg("Text the message to the manager"), end("message_taken", "Got it, someone will get back to you today.")],
        ),
      ],
    }),
  },
  {
    id: "appointment_booking",
    name: "Appointment booking",
    blurb: "Books, moves or cancels appointments on your calendar.",
    direction: "inbound",
    category: "Front desk",
    build: () => ({
      greeting: "Hi, you've reached {business}, this is {agent}, the AI assistant. This call is recorded. Are you booking, moving or cancelling an appointment?",
      steps: [
        choice("What would you like to do?", "request", ["Book", "Move", "Cancel"]),
        text("Can I get your full name?", "full_name"),
        date("What day suits you best?", "preferred_day"),
        book("Main calendar"),
        end("appointment_set", "All done. You'll get a text to confirm. See you then!"),
      ],
    }),
  },
  {
    id: "payment_reminder",
    name: "Payment reminder",
    blurb: "A friendly reminder about an unpaid invoice, with a link by text.",
    direction: "outbound",
    category: "Billing",
    build: () => ({
      greeting: "Hi {first_name}, this is {agent}, the AI assistant at {business}. This call is recorded. Just a quick call about invoice {invoice_number}.",
      steps: [
        say("Our records show {amount} is still open, due on {due_date}."),
        yesno("Would a payment link by text help?", "wants_link"),
        ifYes("wants_link", [textMsg("Text the payment link")], []),
        date("When do you expect to pay?", "promised_date"),
        end("promise_to_pay", "Thanks so much, we've noted that. Have a good day."),
      ],
    }),
  },
  {
    id: "feedback",
    name: "Feedback after a visit",
    blurb: "Asks how it went, saves a score and passes on any problem.",
    direction: "outbound",
    category: "Service",
    build: () => ({
      greeting: "Hi {first_name}, it's {agent}, the AI assistant at {business}. This call is recorded. Got 30 seconds for quick feedback?",
      steps: [
        { id: newId(), kind: "ask", question: "From 1 to 10, how was your visit?", field: "score", answerType: "number" },
        { id: newId(), kind: "branch", condition: { field: "score", op: "less_than", value: "7" }, yes: [text("Sorry about that. What could we have done better?", "feedback"), crm("Create a follow-up task for the manager")], no: [] },
        end("feedback_given", "Thank you, that really helps. Bye for now!"),
      ],
    }),
  },
];

export const DEFAULT_AGENT: AgentVoice = { name: "Ava", voiceId: "v_ava", personality: "friendly", speed: 1, language: "English" };

export function flowFromTemplate(template: FlowTemplate | null, now = new Date()): Flow {
  const body = template?.build() ?? { greeting: "Hi, this is {agent}, the AI assistant at {business}. This call is recorded.", steps: [] };
  return {
    id: newId("f"),
    name: template?.name ?? "Untitled flow",
    description: template?.blurb ?? "",
    direction: template?.direction ?? "outbound",
    status: "draft",
    agent: { ...DEFAULT_AGENT },
    updatedAt: now.toISOString(),
    knowledgeIds: [],
    ...body,
  };
}
