// A practice run of a flow in text: the customer plays the caller, the flow
// runs step by step. It follows the flow exactly, so it shows the path a real
// call takes; the live agent adds the natural conversation around it.

import { conditionHolds } from "./automation";
import { fill } from "./variables";
import { ACTION_LABELS } from "./action-labels";
import type { Flow, Step } from "./types";

export interface PracticeLine {
  who: "agent" | "caller" | "system";
  text: string;
}

export interface PracticeState {
  queue: Step[];
  values: Record<string, string>;
  lines: PracticeLine[];
  waitingFor: Extract<Step, { kind: "ask" }> | null;
  outcome: string | null;
  currentId: string | null; // the step the call is on (a question waiting, or the ending it reached)
}

export interface PracticeContext {
  agentName: string;
  business: string;
  contactFields: Record<string, string>;
}

export function startPractice(flow: Pick<Flow, "greeting" | "steps">, ctx: PracticeContext): PracticeState {
  const values = { ...ctx.contactFields, agent: ctx.agentName, business: ctx.business };
  const greeting: PracticeLine = { who: "agent", text: fill(flow.greeting, values) };
  return run({ queue: [...flow.steps], values, lines: [greeting], waitingFor: null, outcome: null, currentId: null });
}

/** `answer` is what the caller said (shown); `saved` is what the step keeps, when it differs ("yeah sure" -> "Yes"). */
export function answerPractice(state: PracticeState, answer: string, saved = answer): PracticeState {
  if (!state.waitingFor) return state;
  const values = { ...state.values, [state.waitingFor.field]: saved.trim() };
  const lines = [...state.lines, { who: "caller" as const, text: answer.trim() }];
  return run({ ...state, values, lines, waitingFor: null });
}

function run(state: PracticeState): PracticeState {
  const queue = [...state.queue];
  const lines = [...state.lines];
  const values = state.values;
  while (queue.length > 0) {
    const step = queue.shift() as Step;
    if (step.kind === "say") lines.push({ who: "agent", text: fill(step.text, values) });
    if (step.kind === "action") lines.push({ who: "system", text: `${ACTION_LABELS[step.action]}${step.detail ? `: ${step.detail}` : ""}` });
    if (step.kind === "branch") queue.unshift(...(conditionHolds(step.condition, values) ? step.yes : step.no));
    if (step.kind === "ask") {
      lines.push({ who: "agent", text: fill(step.question, values) });
      return { queue, values, lines, waitingFor: step, outcome: null, currentId: step.id };
    }
    if (step.kind === "end") {
      lines.push({ who: "agent", text: fill(step.text, values) });
      return { queue: [], values, lines, waitingFor: null, outcome: step.outcome || "done", currentId: step.id };
    }
  }
  lines.push({ who: "system", text: "The workflow ran out of steps without an ending. Add an \"End call\" step." });
  return { queue: [], values, lines, waitingFor: null, outcome: "no_ending", currentId: null };
}

export { fill };
