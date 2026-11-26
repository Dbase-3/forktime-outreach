// Which parts of an agent use an integration, and which of those aren't
// connected yet. A step that needs one is still added, marked, and the agent
// can't go live until it's connected (owner, 2026-11-27). Pure.

import { ACTION_LABELS } from "./action-labels";
import { integrationInfo } from "./integrations";
import type { AfterCallAction, Flow, Step } from "./types";

export const AFTER_CALL_LABELS: Record<AfterCallAction["kind"], string> = {
  save_contact: "Save the contact",
  add_row: "Add a row",
  send_webhook: "Send the answers to a URL",
  post_message: "Post a message",
};

/** An integration that must be connected before it can be used ("webhook" is just a URL). */
export function needsConnection(id: string | undefined): id is string {
  return Boolean(id && id !== "webhook" && integrationInfo(id));
}

export const integrationName = (id: string) => integrationInfo(id)?.name ?? id;

export interface Missing {
  integration: string;
  name: string;
  where: string; // "Step “Save to GHL”", "After the call", "Tool “Check availability”"
  stepId: string | null;
}

/** Everything in the agent that uses an integration the workspace hasn't connected. */
export function missingIntegrations(agent: Pick<Flow, "steps"> & Partial<Pick<Flow, "tools" | "afterCall">>, connected: string[]): Missing[] {
  const have = new Set(connected);
  const out: Missing[] = [];
  const walk = (steps: Step[]) =>
    steps.forEach((s) => {
      if (s.kind === "action" && needsConnection(s.integration) && !have.has(s.integration)) out.push({ integration: s.integration, name: integrationName(s.integration), where: `“${ACTION_LABELS[s.action]}” step`, stepId: s.id });
      if (s.kind === "branch") (walk(s.yes), walk(s.no));
    });
  walk(agent.steps);
  for (const a of agent.afterCall ?? []) if (needsConnection(a.integration) && !have.has(a.integration)) out.push({ integration: a.integration, name: integrationName(a.integration), where: `After the call: ${AFTER_CALL_LABELS[a.kind].toLowerCase()}`, stepId: null });
  for (const t of agent.tools ?? []) if (t.kind === "integration" && needsConnection(t.integration) && !have.has(t.integration)) out.push({ integration: t.integration, name: integrationName(t.integration), where: `Tool “${t.name}”`, stepId: null });
  return out;
}

