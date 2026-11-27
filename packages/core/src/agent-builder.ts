// "Change with AI": what the AI that edits an agent is told, and how it sees
// the agent and the workspace. The edits themselves are agent-edits.ts; the
// API runs the model with those as tools. Pure.

import { ACTION_LABELS } from "./action-labels";
import { AFTER_CALL_LABELS, integrationName } from "./connections";
import { AVAILABLE_INTEGRATIONS } from "./integrations";

/** What Change with AI may set as an integration: the available tools, plus a webhook to the owner's own URL. */
export const BUILDER_INTEGRATION_IDS: [string, ...string[]] = ["webhook", ...AVAILABLE_INTEGRATIONS.map((i) => i.id)];
import { VOICES } from "./voices";
import type { EditableAgent } from "./agent-edits";
import type { Step } from "./types";

export const BUILDER_SYSTEM = `You change one AI phone agent for a business owner. You make changes only through your tools; the owner sees each change and can undo it.

Make the change they asked for and nothing else. Keep everything you weren't asked to touch, word for word.

Where each kind of request goes:
- A fixed order of things to say and ask, "if they say X, do Y": workflow steps (say, ask, decide, action, end). The system runs the workflow in code; the agent only words the lines.
- How it talks and behaves (tone, rules, what never to say): the instructions. Edit them with set_text, keeping the rest of the text as it is.
- Something to do at a point in the call ("when they say yes, book it", "send this to my API"): an action step at that point. A call to their own URL is action "webhook" with the URL in the detail.
- Something to save or send once the call is over ("at the end, save to GoHighLevel", "send the answers to my webhook"): an after-call action. Never a workflow step.
- Something the agent looks up mid-call when the caller asks ("when they ask for times, check my calendar"): a tool, kind "integration".
- Something to pick up from the conversation without asking for it: listen_for.

Rules:
- Every workflow path ends with an End step. Put new steps before the End on that path.
- Lines in steps are spoken on a phone: short, plain, one question at a time. Variables in braces like {first_name} are filled in on the call.
- The welcome message must keep saying it's an AI assistant and that the call is recorded.
- Field keys are lower_case_with_underscores. A decision can only test a field asked earlier on that path, or one the contact already has.
- When something needs an integration, set it from the list even if it isn't connected yet. Don't refuse and don't ask them to connect it first: the screen marks it and offers Connect.
- Only the integrations in the list exist. If they ask for any other tool (Slack, Google Sheets, HubSpot, Google Calendar, …), don't add it: say it isn't available yet, and offer a webhook to their own URL if that would do the job.
- Never store API keys, passwords or tokens anywhere. If they paste one, leave it out and tell them to add it under Integrations.
- If the request is unclear, or can't be done with these tools, change nothing and ask one short question.

When you're done, reply in one or two plain sentences saying what you changed. No lists, no step ids: the screen lists the changes.`;

function outline(steps: Step[], depth = 0): string[] {
  const pad = "  ".repeat(depth);
  return steps.flatMap((s) => {
    if (s.kind === "say") return [`${pad}[${s.id}] Say: "${s.text}"`];
    if (s.kind === "ask") return [`${pad}[${s.id}] Ask: "${s.question}" → saves ${s.field} (${s.answerType}${s.choices?.length ? `: ${s.choices.join(" / ")}` : ""})`];
    if (s.kind === "action") return [`${pad}[${s.id}] Action ${s.action} (${ACTION_LABELS[s.action]})${s.integration ? ` via ${s.integration}` : ""}: ${s.detail}`];
    if (s.kind === "end") return [`${pad}[${s.id}] End (${s.outcome}): "${s.text}"`];
    const c = s.condition;
    return [`${pad}[${s.id}] Decide: ${c.field} ${c.op}${c.value ? ` ${c.value}` : ""}${c.value2 ? ` and ${c.value2}` : ""}`, `${pad}  Yes:`, ...outline(s.yes, depth + 2), `${pad}  No:`, ...outline(s.no, depth + 2)];
  });
}

export interface BuilderWorkspace {
  business: string;
  contactFields: { key: string; label: string; type: string }[];
  connected: string[];
  knowledge: { id: string; name: string; availableToAll: boolean }[];
}

/** The agent and the workspace as the AI sees them, ids included so it can point at things. */
export function builderContext(agent: EditableAgent, ws: BuilderWorkspace): string {
  const v = agent.agent;
  const connected = new Set(ws.connected);
  return [
    "# The agent",
    `Name: ${agent.name}`,
    `Description: ${agent.description || "(none)"}`,
    `Direction: ${agent.direction}`,
    `Voice: ${v.name} (voice ${v.voiceId}), ${v.personality}, speed ${v.speed}, speaks ${v.language}`,
    `Welcome message: "${agent.greeting}"`,
    `Speaks for ({business}): ${agent.business?.trim() || `${ws.business || "the workspace's business"} (the workspace's own)`}`,
    "Instructions:",
    "<<<",
    agent.prompt,
    ">>>",
    "Workflow:",
    ...(agent.steps.length ? outline(agent.steps) : ["(no steps yet)"]),
    `Answers that may be missing (not required): ${Object.entries(agent.askRequired).filter(([, r]) => !r).map(([k]) => k).join(", ") || "none"}`,
    `Listens for: ${agent.dataFields.map((f) => `${f.key} (${f.type}${f.required ? ", required" : ""}) ${f.description}`).join("; ") || "nothing"}`,
    `After the call: ${(agent.afterCall ?? []).map((a) => `[${a.id}] ${AFTER_CALL_LABELS[a.kind]} in ${integrationName(a.integration)}${a.fields.length ? ` (${a.fields.join(", ")})` : ""}: ${a.detail}`).join("; ") || "nothing"}`,
    `Tools: ${agent.tools.map((t) => `[${t.id}] ${t.name}${t.integration ? ` via ${t.integration}` : ""}: ${t.description}`).join("; ") || "none"}`,
    `Success checks: ${agent.checks.map((c) => c.label).join("; ") || "none"}`,
    `Knowledge attached: ${ws.knowledge.filter((k) => agent.knowledgeIds.includes(k.id)).map((k) => `[${k.id}] ${k.name}`).join("; ") || "none"}`,
    "",
    "# The workspace",
    `Business: ${ws.business || "(not set)"}`,
    `Contact fields (usable as {key} and in decisions): first_name, name, phone${ws.contactFields.length ? `, ${ws.contactFields.map((f) => `${f.key} (${f.type})`).join(", ")}` : ""}`,
    `Knowledge library: ${ws.knowledge.map((k) => `[${k.id}] ${k.name}${k.availableToAll ? " (every agent)" : ""}`).join("; ") || "empty"}`,
    `Voices: ${VOICES.map((x) => `${x.id} ${x.name} (${x.gender}, ${x.accent})`).join("; ")}`,
    `Integrations (id: name, connected or not): ${AVAILABLE_INTEGRATIONS.map((i) => `${i.id}: ${i.name}${connected.has(i.id) ? " (connected)" : " (not connected)"}`).join("; ")}; webhook: Webhook (any URL)`,
  ].join("\n");
}
