// "Change with AI": the owner says what to change in plain words; Claude makes
// it through small, checked edits (@outreach/core/agent-edits) on a copy of the
// agent. Nothing is saved here: the screen shows the changes and saves the new
// draft itself (with Undo), the same way as any other edit.

import { Inject, Injectable, Logger } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { BUILDER_SYSTEM, builderContext, type BuilderWorkspace } from "@outreach/core/agent-builder";
import { EditError, addAfterCall, addStep, addTool, changeStep, deleteStep, missingIntegrations, removeAfterCall, removeData, setCheck, setData, type EditableAgent, type Edit, type StepInput, type Where } from "@outreach/core/agent-edits";
import { AgentDraftSchema, BRIEF_MAX, OPS, type AgentDraft } from "@outreach/core/schemas";
import { INTEGRATIONS } from "@outreach/core/integrations";
import { greetingIsHonest } from "@outreach/core/disclosure";
import { VOICES } from "@outreach/core/voices";
import { Types } from "mongoose";
import { z } from "zod";
import { ApiError, notFound, tooMany, unprocessable } from "../../common/errors";
import { WorkspaceData } from "../../common/workspace-data";
import { ENV, type Env } from "../../config/env";
import type { M } from "../../db/models";

const PER_HOUR = 60; // changes per workspace per hour

export const BuilderBody = z.object({
  message: z.string().trim().min(2).max(BRIEF_MAX),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(BRIEF_MAX) })).max(12).default([]),
});

const INTEGRATION_IDS = INTEGRATIONS.map((i) => i.id) as [string, ...string[]];
const ANSWER = z.enum(["text", "yesno", "number", "date", "choice"]);
const Condition = z.object({ field: z.string().describe("The field it checks"), op: z.enum(OPS), value: z.string().optional(), value2: z.string().optional().describe("Upper end, for between") });
const Leaf = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("say"), text: z.string() }),
  z.object({ kind: z.literal("ask"), question: z.string(), field: z.string().describe("Where the answer is saved, lower_case"), answerType: ANSWER, choices: z.array(z.string()).optional(), required: z.boolean().optional().describe("False if the call may end without it") }),
  z.object({ kind: z.literal("action"), action: z.enum(["book", "transfer", "text", "crm", "webhook"]), detail: z.string().describe("What it does, in plain words (for webhook: the URL)"), integration: z.enum(INTEGRATION_IDS).optional() }),
  z.object({ kind: z.literal("end"), outcome: z.string().describe("lower_case outcome name"), text: z.string().describe("The last thing the agent says") }),
]);
const StepIn = z.union([Leaf, z.object({ kind: z.literal("branch"), condition: Condition, yes: z.array(Leaf).optional(), no: z.array(Leaf).optional() })]);

type Turn = { message: string; history: { role: "user" | "assistant"; text: string }[] };

@Injectable()
export class BuilderService {
  private readonly log = new Logger("Builder");
  private readonly used = new Map<string, number[]>();

  constructor(
    @Inject(ENV) private readonly env: Env,
    @InjectModel("Agent") private readonly agents: M<"Agent">,
    @InjectModel("Integration") private readonly integrations: M<"Integration">,
    @InjectModel("Knowledge") private readonly knowledge: M<"Knowledge">,
    private readonly data: WorkspaceData,
  ) {}

  /** Seam for tests: the model client. */
  client(): Anthropic {
    const apiKey = this.env.ANTHROPIC_API_KEY || this.env.ANTHROPIC_API_KEY_EVAL;
    if (!apiKey) throw new ApiError(503, "ai_off", "Changing agents with AI isn't set up on this server yet.");
    return new Anthropic({ apiKey });
  }

  async change(ws: Types.ObjectId, agentId: Types.ObjectId, turn: Turn) {
    this.limit(String(ws));
    const row = await this.agents.findOne({ _id: agentId, workspaceId: ws, deletedAt: null }).lean();
    if (!row) throw notFound("That agent");
    const draft = row.draft as AgentDraft;
    const workspace = await this.workspace(ws);
    let agent: EditableAgent = { ...draft, afterCall: draft.afterCall ?? [] };
    const changes: string[] = [];

    /** Runs one edit; the model hears what happened, or why it couldn't. */
    const apply = (fn: (a: EditableAgent) => Edit): string => {
      try {
        const e = fn(agent);
        agent = e.agent;
        changes.push(e.said);
        const missing = missingIntegrations(agent, workspace.connected).map((m) => m.name);
        return `Done: ${e.said}.${missing.length ? ` Not connected yet (the screen offers Connect): ${[...new Set(missing)].join(", ")}.` : ""}`;
      } catch (err) {
        if (err instanceof EditError) return `Not done: ${err.message}`;
        throw err;
      }
    };

    const tools = [
      betaZodTool({
        name: "add_step",
        description: "Add a workflow step. position: after/before an existing step (ref = its id), inside_yes/inside_no a decision (ref = the decision's id), or start/end of the top level. A decision may hold simple steps; add deeper ones with more add_step calls inside it.",
        inputSchema: z.object({ position: z.enum(["after", "before", "inside_yes", "inside_no", "start", "end"]), ref: z.string().optional(), step: StepIn }),
        run: async ({ position, ref, step }) => {
          const where: Where | null = position === "start" || position === "end" ? { at: position } : !ref ? null : position === "after" ? { after: ref } : position === "before" ? { before: ref } : { inside: ref, side: position === "inside_yes" ? "yes" : "no" };
          if (!where) return "Not done: say which step (ref).";
          return apply((a) => addStep(a, where, step as StepInput));
        },
      }),
      betaZodTool({
        name: "change_step",
        description: "Change an existing step's settings. Give only what changes.",
        inputSchema: z.object({ id: z.string(), text: z.string().optional(), question: z.string().optional(), field: z.string().optional(), answerType: ANSWER.optional(), choices: z.array(z.string()).optional(), condition: Condition.optional(), action: z.enum(["book", "transfer", "text", "crm", "webhook"]).optional(), detail: z.string().optional(), integration: z.enum(INTEGRATION_IDS).optional(), outcome: z.string().optional() }),
        run: async ({ id, ...patch }) => apply((a) => changeStep(a, id, patch)),
      }),
      betaZodTool({
        name: "remove_step",
        description: "Remove a step (a decision goes with everything inside it).",
        inputSchema: z.object({ id: z.string() }),
        run: async ({ id }) => apply((a) => deleteStep(a, id)),
      }),
      betaZodTool({
        name: "set_text",
        description: "Replace the agent's name, description, welcome message, instructions, direction (inbound / outbound / both), or company (who it says it's from; {business} says it; empty = the workspace's business). For instructions, give the whole new text with only the asked-for part changed.",
        inputSchema: z.object({ what: z.enum(["name", "description", "welcome", "instructions", "direction", "company"]), value: z.string() }),
        run: async ({ what, value }) =>
          apply((a) => {
            const v = value.trim();
            if (what === "direction" && !["inbound", "outbound", "both"].includes(v)) throw new EditError("Direction is inbound, outbound or both.");
            // Every caller must hear both, in every welcome (product rule): a rewrite that drops one is sent back.
            if (what === "welcome" && !greetingIsHonest(v)) throw new EditError("The welcome message must say it's an AI assistant and that the call is recorded. Keep both and try again.");
            const key = { name: "name", description: "description", welcome: "greeting", instructions: "prompt", direction: "direction", company: "business" }[what] as keyof EditableAgent;
            return { agent: { ...a, [key]: v }, said: what === "instructions" ? "Updated the instructions" : what === "welcome" ? `Welcome message: “${v}”` : `${what[0].toUpperCase()}${what.slice(1)}: ${v}` };
          }),
      }),
      betaZodTool({
        name: "set_voice",
        description: "Change the voice, the name it uses on calls, its personality, speed (0.9 to 1.2) or language.",
        inputSchema: z.object({ voiceId: z.enum(VOICES.map((v) => v.id) as [string, ...string[]]).optional(), name: z.string().optional(), personality: z.enum(["friendly", "professional", "upbeat", "calm"]).optional(), speed: z.number().min(0.9).max(1.2).optional(), language: z.string().optional() }),
        run: async (patch) => apply((a) => ({ agent: { ...a, agent: { ...a.agent, ...Object.fromEntries(Object.entries(patch).filter(([, x]) => x !== undefined)) } }, said: `Voice: ${Object.entries(patch).filter(([, x]) => x !== undefined).map(([k, x]) => `${k} ${x}`).join(", ")}` })),
      }),
      betaZodTool({
        name: "set_answer_required",
        description: "Whether an Ask step's answer must be collected for the call to count as complete.",
        inputSchema: z.object({ field: z.string(), required: z.boolean() }),
        run: async ({ field, required }) => apply((a) => ({ agent: { ...a, askRequired: { ...a.askRequired, [field]: required } }, said: `“${field}” is ${required ? "required" : "optional"}` })),
      }),
      betaZodTool({
        name: "listen_for",
        description: "Pick something up from the conversation without a question for it (adds or updates a data field).",
        inputSchema: z.object({ key: z.string().optional(), label: z.string(), type: z.enum(["text", "number", "date", "yesno", "choice", "phone", "email"]), description: z.string().describe("What to listen for, in plain words"), required: z.boolean(), fallback: z.string().optional(), choices: z.array(z.string()).optional() }),
        run: async (f) => apply((a) => setData(a, f)),
      }),
      betaZodTool({ name: "stop_listening", description: "Remove a data field.", inputSchema: z.object({ key: z.string() }), run: async ({ key }) => apply((a) => removeData(a, key)) }),
      betaZodTool({
        name: "add_after_call",
        description: "Do something once the call has ended, with what it collected: save_contact (to a CRM), add_row (to a sheet), send_webhook (to their URL; put the URL in detail), post_message (Slack, Teams).",
        inputSchema: z.object({ kind: z.enum(["save_contact", "add_row", "send_webhook", "post_message"]), integration: z.enum(INTEGRATION_IDS), fields: z.array(z.string()).describe("Field keys to send; empty for everything"), detail: z.string() }),
        run: async (x) => apply((a) => addAfterCall(a, x)),
      }),
      betaZodTool({ name: "remove_after_call", description: "Remove an after-call action.", inputSchema: z.object({ id: z.string() }), run: async ({ id }) => apply((a) => removeAfterCall(a, id)) }),
      betaZodTool({
        name: "add_tool",
        description: "Give the agent something to look up or do mid-call when the caller asks (e.g. check calendar availability). kind integration needs integration; kind api needs a URL.",
        inputSchema: z.object({ kind: z.enum(["integration", "api"]), integration: z.enum(INTEGRATION_IDS).optional(), url: z.string().optional(), name: z.string(), description: z.string().describe("When the agent should use it") }),
        run: async ({ kind, integration, url, name, description }) =>
          apply((a) => {
            if (kind === "integration" && !integration) throw new EditError("Pick the integration.");
            if (kind === "api" && !/^https?:\/\//.test(url ?? "")) throw new EditError("An API tool needs its URL.");
            return addTool(a, { kind, integration, url: kind === "api" ? (url as string) : "", name, description });
          }),
      }),
      betaZodTool({ name: "remove_tool", description: "Remove a tool.", inputSchema: z.object({ id: z.string() }), run: async ({ id }) => apply((a) => { const t = a.tools.find((x) => x.id === id); if (!t) throw new EditError(`There's no tool ${id}.`); return { agent: { ...a, tools: a.tools.filter((x) => x.id !== id) }, said: `Removed the tool ${t.name}` }; }) }),
      betaZodTool({ name: "set_check", description: "Add or change a success check: how to tell the call did its job.", inputSchema: z.object({ label: z.string(), description: z.string() }), run: async (c) => apply((a) => setCheck(a, c)) }),
      betaZodTool({
        name: "attach_knowledge",
        description: "Attach or detach a knowledge document (id from the library).",
        inputSchema: z.object({ id: z.string(), attach: z.boolean() }),
        run: async ({ id, attach }) =>
          apply((a) => {
            const doc = workspace.knowledge.find((k) => k.id === id);
            if (!doc) throw new EditError(`There's no document ${id}.`);
            const ids = attach ? [...new Set([...a.knowledgeIds, id])] : a.knowledgeIds.filter((x) => x !== id);
            return { agent: { ...a, knowledgeIds: ids }, said: `${attach ? "Attached" : "Detached"} “${doc.name}”` };
          }),
      }),
    ];

    const messages: Anthropic.Beta.BetaMessageParam[] = [
      ...turn.history.map((h) => ({ role: h.role, content: h.text })),
      { role: "user", content: `${builderContext(agent, workspace)}\n\n# What to change\n${turn.message}` },
    ];
    // History must start with the owner and alternate; drop what doesn't fit.
    while (messages.length && messages[0].role !== "user") messages.shift();

    let reply = "";
    try {
      const final = await this.client().beta.messages.toolRunner({
        model: this.env.BUILDER_MODEL,
        max_tokens: 8000,
        thinking: { type: "adaptive" },
        output_config: { effort: "medium" },
        system: [{ type: "text", text: BUILDER_SYSTEM, cache_control: { type: "ephemeral" } }],
        tools,
        messages,
        max_iterations: 16,
      });
      reply = final.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join(" ").trim();
      if (final.stop_reason === "refusal") reply = "I can't make that change.";
    } catch (err) {
      if (err instanceof ApiError) throw err;
      if (err instanceof Anthropic.RateLimitError) throw tooMany("The AI is busy just now. Try again in a minute.");
      if (err instanceof Anthropic.APIError) {
        this.log.warn(`model error ${err.status}: ${err.message}`);
        throw new ApiError(502, "ai_failed", "The AI had a problem. Try again.");
      }
      throw err;
    }

    const parsed = AgentDraftSchema.safeParse({ ...draft, ...agent });
    if (!parsed.success) {
      this.log.warn(`builder left an invalid draft: ${parsed.error.issues.map((i) => i.path.join(".") + " " + i.message).join("; ")}`);
      throw unprocessable("That change didn't fit the agent. Try saying it another way.");
    }
    return { draft: parsed.data, changes, reply: reply || (changes.length ? "Done." : "Nothing changed."), needs: missingIntegrations(parsed.data, workspace.connected) };
  }

  private async workspace(ws: Types.ObjectId): Promise<BuilderWorkspace> {
    const [settings, defs, connected, docs] = await Promise.all([
      this.data.settings(ws),
      this.data.defs(ws),
      this.integrations.find({ workspaceId: ws, connected: true }, { providerId: 1 }).lean(),
      this.knowledge.find({ workspaceId: ws, deletedAt: null }, { name: 1, availableToAll: 1 }).lean(),
    ]);
    return {
      business: settings.businessName,
      contactFields: defs.map((d) => ({ key: d.key, label: d.label, type: d.type })),
      connected: connected.map((c) => c.providerId),
      knowledge: docs.map((d) => ({ id: String(d._id), name: d.name, availableToAll: Boolean(d.availableToAll) })),
    };
  }

  private limit(ws: string) {
    const now = Date.now();
    const recent = (this.used.get(ws) ?? []).filter((t) => now - t < 3_600_000);
    if (recent.length >= PER_HOUR) throw tooMany("That's a lot of AI changes for one hour. Try again a bit later.");
    recent.push(now);
    this.used.set(ws, recent);
  }
}

