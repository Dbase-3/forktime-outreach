// Writes an agent (prompt + workflow) or just its workflow from a plain
// description. Iteration 1 runs locally on the eval key; the backend will own
// the real key and per-workspace limits.

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { NextResponse } from "next/server";
import { AgentDraft, DRAFT_SYSTEM, WorkflowDraft, applyDraft, draftUserMessage, toSteps, type DraftRequest } from "@/lib/agent-draft";

export const runtime = "nodejs";
export const maxDuration = 120;

const MODEL = "claude-opus-5-5";

function bad(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

export async function POST(request: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY_EVAL || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return bad(503, "Writing agents with AI isn't set up on this server yet.");

  let body: DraftRequest;
  try {
    body = (await request.json()) as DraftRequest;
  } catch {
    return bad(400, "That request wasn't readable.");
  }
  const brief = String(body.brief ?? "").trim().slice(0, 4000);
  const mode = body.mode === "workflow" ? "workflow" : "agent";
  if (mode === "agent" && brief.length < 8) return bad(400, "Describe the agent in a sentence or two.");
  if (mode === "workflow" && !body.agent) return bad(400, "Nothing to rebuild.");

  const req: DraftRequest = {
    mode,
    brief,
    business: String(body.business ?? "").slice(0, 120),
    fields: Array.isArray(body.fields) ? body.fields.slice(0, 60) : [],
    agent: body.agent,
  };
  const client = new Anthropic({ apiKey });
  const common = {
    model: MODEL,
    max_tokens: 12000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default" as const,
    output_config: { effort: "medium" as const },
    system: [{ type: "text" as const, text: DRAFT_SYSTEM, cache_control: { type: "ephemeral" as const } }],
    messages: [{ role: "user" as const, content: draftUserMessage(req) }],
  };

  try {
    if (mode === "workflow") {
      const res = await client.beta.messages.parse({ ...common, output_config: { ...common.output_config, format: betaZodOutputFormat(WorkflowDraft) } });
      if (res.stop_reason === "refusal" || !res.parsed_output) return bad(422, "Couldn't write a workflow for that. Try describing it differently.");
      return NextResponse.json({ steps: toSteps(res.parsed_output.steps) });
    }
    const res = await client.beta.messages.parse({ ...common, output_config: { ...common.output_config, format: betaZodOutputFormat(AgentDraft) } });
    if (res.stop_reason === "refusal" || !res.parsed_output) return bad(422, "Couldn't write an agent for that. Try describing it differently.");
    return NextResponse.json({ draft: applyDraft(res.parsed_output) });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) return bad(429, "Too many requests just now. Try again in a minute.");
    if (error instanceof Anthropic.AuthenticationError) return bad(503, "Writing agents with AI isn't set up on this server yet.");
    if (error instanceof Anthropic.APIError) {
      console.error("[agents/generate]", error.status, error.message);
      return bad(502, "The AI writer had a problem. Try again.");
    }
    console.error("[agents/generate]", error);
    return bad(500, "Something went wrong. Try again.");
  }
}
