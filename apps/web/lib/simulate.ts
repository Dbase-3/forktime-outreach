import { appendTranscript, endCall, markAnswered, setSimStep, setStage, type CallEnding } from "./calls-repo";
import { buildOpeningLine, firstName } from "./opening-line";
import type { Call, Settings, TranscriptRole } from "./types";

// Dry run: with DIAL_MODE unset no phone rings. The app acts a call out on
// screen instead, one line every few seconds, so the queue, the live
// transcript and the outcomes can be seen working before a real call is made.

type Step =
  | { kind: "answer" }
  | { kind: "line"; role: TranscriptRole; text: string }
  | { kind: "stage"; stage: "transferring" | "with_rep" }
  | { kind: "end"; ending: CallEnding };

const STEP_SECONDS = 2.5;

function scripts(settings: Settings, call: Call): Step[][] {
  const rep = firstName(settings.repName);
  const place = call.label || "the restaurant";
  const opening = buildOpeningLine(settings);
  const say = (role: TranscriptRole, text: string): Step => ({ kind: "line", role, text });
  return [
    [
      { kind: "answer" },
      say("callee", `Good afternoon, ${place}.`),
      say("agent", opening),
      say("callee", "She's not in at the moment. Can I take a message?"),
      say("agent", "Thanks. Please ask her to call us back on the number this call came from. When is a good time to catch her?"),
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
      say("callee", "Speaking, I'm the owner. An AI, really? What's this about?"),
      say("agent", `Really. ${rep}'s team built me to answer restaurant phones and take bookings. Want me to put ${rep} on now? It takes two minutes.`),
      say("callee", "Sure, go on then."),
      say("agent", `Great, connecting you to ${rep} now.`),
      { kind: "stage", stage: "transferring" },
      { kind: "stage", stage: "with_rep" },
      say("system", `Connected to ${settings.repName}.`),
      {
        kind: "end",
        ending: { outcome: "transferred", summary: `The owner answered and agreed to speak with ${rep}.`, ownerReached: true, interested: true },
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
    else if (current.kind === "stage") await setStage(call._id, current.stage);
    else {
      await endCall(call._id, current.ending, now);
      return true;
    }
  }
  if (step !== (call.simStep ?? 0)) await setSimStep(call._id, step);
  return false;
}
