import { appendTranscript, endCall, markAnswered, setSimStep, type CallEnding } from "./calls-repo";
import { buildOpeningLine } from "./opening-line";
import type { Call, Settings, TranscriptRole } from "./types";

// Dry run: with DIAL_MODE unset no phone rings. The app acts a call out on
// screen instead, one line every few seconds, so the queue, the live
// transcript and the outcomes can be seen working before a real call is made.

type Step =
  | { kind: "answer" }
  | { kind: "line"; role: TranscriptRole; text: string }
  | { kind: "end"; ending: CallEnding };

const STEP_SECONDS = 2.5;

function scripts(settings: Settings, call: Call): Step[][] {
  const place = call.label || "the restaurant";
  const opening = buildOpeningLine(settings);
  const say = (role: TranscriptRole, text: string): Step => ({ kind: "line", role, text });
  return [
    [
      { kind: "answer" },
      say("callee", `Good afternoon, ${place}.`),
      say("agent", opening),
      say("callee", "Yes, we are."),
      say("agent", "Great. Do you also handle catering or group bookings for around 15 to 20 people?"),
      say("callee", "Yes."),
      say("agent", "Perfect. Is the owner or manager available? I’d like to discuss some potential booking opportunities and confirm a few details with them."),
      say("callee", "She's not in at the moment."),
      say("agent", "No problem. Would it be better for me to call her again, or could she give us a call when she’s available?"),
      say("callee", "You can call back."),
      say("agent", "Sure. When would be the best time to reach her?"),
      say("callee", "Try after three tomorrow."),
      say("agent", "After three tomorrow, got it. Thanks for your help. Bye."),
      {
        kind: "end",
        ending: {
          outcome: "call_back_later",
          summary: "Staff answered. The owner was out; best time to call is after 3 PM tomorrow.",
          ownerReached: false,
          callbackTime: "After 3 PM tomorrow",
        },
      },
    ],
    [
      { kind: "answer" },
      say("callee", `${place}, hello?`),
      say("agent", opening),
      say("callee", "Yes, you're speaking with the owner."),
      say("agent", "Thanks, who am I speaking with?"),
      say("callee", "I'm Raj."),
      say("agent", "Hi! I was checking whether you could accommodate a group of around 15 people next week, including guests who need vegetarian and gluten-free options."),
      say("callee", "Yes, we can."),
      say("agent", "Perfect. And you handle catering inquiries for larger groups as well?"),
      say("callee", "Yes. Who is this, by the way?"),
      say("agent", `I’m ${settings.agentName}, an AI assistant from ${settings.company}. We help restaurants capture more reservations and catering inquiries through various websites. We also answer restaurant phone calls and take reservations automatically.`),
      say("agent", "Would you be interested in getting more booking inquiries or having an AI assistant handle your reservation calls?"),
      say("callee", "Yes, the AI phone answering sounds interesting."),
      say("agent", "Great! I can have someone from our team give you a quick call to explain how it works. Would that be okay?"),
      say("callee", "Sure."),
      say("agent", "Perfect. What’s the best number to reach you?"),
      say("callee", "This number is best."),
      say("agent", "What’s the best time to reach you?"),
      say("callee", "Tomorrow around 2 PM."),
      say("agent", "Wonderful, Raj. I’ll pass that along to our team. Thanks for your time!"),
      {
        kind: "end",
        ending: {
          outcome: "owner_callback",
          summary: "Raj was interested in AI phone answering and agreed to a callback tomorrow around 2 PM.",
          ownerReached: true,
          contactName: "Raj",
          callbackNumber: call.phone,
          callbackTime: "Tomorrow around 2 PM",
          callbackPermission: true,
          takesCatering: true,
          takesLargeBookings: true,
          dietaryOptions: "Vegetarian and gluten-free options available",
          interested: true,
          interestedInSystem: true,
        },
      },
    ],
    [
      { kind: "answer" },
      say("callee", `You've reached ${place}. We can't take your call right now. Please leave a message after the tone.`),
      say("agent", opening),
      { kind: "end", ending: { outcome: "voicemail", summary: "Voicemail answered.", ownerReached: false } },
    ],
  ];
}

/** Which script a call plays: spread across the calls so a batch shows each ending. */
function scriptFor(settings: Settings, call: Call): Step[] {
  const all = scripts(settings, call);
  return all[call.order % all.length];
}

/**
 * Move a simulated call forward by as many steps as its clock allows.
 * Returns true once the call has ended.
 */
export async function advanceSimulation(call: Call, settings: Settings, now = new Date()): Promise<boolean> {
  const script = scriptFor(settings, call);
  const started = call.startedAt ?? now;
  const due = Math.min(script.length, Math.floor((now.getTime() - started.getTime()) / 1000 / STEP_SECONDS));
  let step = call.simStep ?? 0;

  for (; step < due; step += 1) {
    const current = script[step];
    if (current.kind === "answer") await markAnswered(call._id, now);
    else if (current.kind === "line") await appendTranscript(call._id, { seq: step + 1, role: current.role, text: current.text, at: now });
    else {
      await endCall(call._id, current.ending, now);
      return true;
    }
  }
  if (step !== (call.simStep ?? 0)) await setSimStep(call._id, step);
  return false;
}
