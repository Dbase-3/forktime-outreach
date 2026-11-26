"use client";

// What the agent can reach beyond talking: the actions its workflow uses (and
// which connected app runs each), plus MCP servers and APIs, coming soon.
// Tools added now are saved and connect when the backend lands.

import clsx from "clsx";
import { Blocks, Globe, Plug, Plus, Server, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ACTION_LABELS } from "@outreach/core/action-labels";
import { allSteps, newId } from "@outreach/core/flow-tree";
import { INTEGRATIONS, integrationInfo, type IntegrationCategory } from "@outreach/core/integrations";
import type { ActionKind, AgentTool, AppState, Flow } from "@outreach/core/types";
import { IntegrationLogo } from "../integrations";
import { Badge, Field, Sheet } from "../ui";

const RUNS_ON: Partial<Record<ActionKind, { categories: IntegrationCategory[]; missing: string }>> = {
  book: { categories: ["calendar", "crm"], missing: "Connect a calendar" },
  crm: { categories: ["crm"], missing: "Connect a CRM" },
};

export function ToolsTab({ flow, app, onEdit }: { flow: Flow; app: AppState; onEdit: (fn: (f: Flow) => Flow) => void }) {
  const [adding, setAdding] = useState<AgentTool["kind"] | null>(null);
  const used = [...new Set(allSteps(flow.steps).flatMap((s) => (s.kind === "action" ? [s.action] : [])))];
  const connected = INTEGRATIONS.filter((i) => app.integrations.some((c) => c.id === i.id && c.connected));

  return (
    <div className="space-y-6 p-4">
      <section>
        <h3 className="eyebrow mb-2">Used by the workflow</h3>
        {used.length === 0 ? (
          <p className="text-sm text-fg-3">No actions yet. Add a Book, Transfer, Text, CRM or Webhook step in the workflow.</p>
        ) : (
          <ul className="divide-y divide-line rounded-xl border border-line">
            {used.map((action) => {
              const need = RUNS_ON[action];
              const apps = need ? connected.filter((i) => need.categories.includes(i.category)) : [];
              return (
                <li key={action} className="flex items-center gap-3 px-3 py-2.5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-fg-2"><Blocks size={15} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{ACTION_LABELS[action]}</span>
                    <span className="block truncate text-xs text-fg-3">
                      {need ? (apps.length ? `Through ${apps.map((a) => a.name).join(", ")}` : "No app connected yet") : action === "text" ? (app.numbers.find((n) => n.id === flow.numberId) ? `From ${app.numbers.find((n) => n.id === flow.numberId)?.display}` : "Needs a phone number") : "Built in"}
                    </span>
                  </span>
                  {need && apps.length === 0 ? (
                    <Link href="/integrations" className="text-xs font-medium text-accent hover:underline">{need.missing}</Link>
                  ) : apps.length > 0 ? (
                    <span className="flex -space-x-1">{apps.slice(0, 3).map((a) => <IntegrationLogo key={a.id} info={a} size="sm" />)}</span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <div className="mb-2 flex items-center gap-2">
          <h3 className="eyebrow">MCP servers and APIs</h3>
          <Badge tone="brand">Coming soon</Badge>
        </div>
        <p className="mb-3 text-sm text-fg-3">Let the agent look things up or take actions in your own systems mid-call: stock, prices, order status, your booking engine. Add them now; they connect at launch.</p>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setAdding("mcp")} className="flex flex-col items-start gap-1 rounded-xl border border-line p-3 text-left transition-colors hover:border-line-strong hover:bg-subtle">
            <Server size={16} className="text-fg-2" />
            <span className="text-sm font-medium">MCP server</span>
            <span className="text-xs text-fg-3">Any server&apos;s tools</span>
          </button>
          <button type="button" onClick={() => setAdding("api")} className="flex flex-col items-start gap-1 rounded-xl border border-line p-3 text-left transition-colors hover:border-line-strong hover:bg-subtle">
            <Globe size={16} className="text-fg-2" />
            <span className="text-sm font-medium">API request</span>
            <span className="text-xs text-fg-3">Call one endpoint</span>
          </button>
        </div>
        {flow.tools.length > 0 && (
          <ul className="mt-3 divide-y divide-line rounded-xl border border-line">
            {flow.tools.map((tool) => (
              <li key={tool.id} className="flex items-center gap-3 px-3 py-2.5">
                {tool.kind === "integration" && integrationInfo(tool.integration ?? "") ? (
                  <IntegrationLogo info={integrationInfo(tool.integration ?? "")!} size="sm" />
                ) : (
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-fg-2">{tool.kind === "mcp" ? <Server size={15} /> : <Plug size={15} />}</span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{tool.name}</span>
                  <span className={clsx("block truncate text-xs text-fg-3", tool.kind !== "integration" && "font-mono")}>{tool.kind === "integration" ? `${integrationInfo(tool.integration ?? "")?.name ?? tool.integration} · ${tool.description}` : tool.url}</span>
                </span>
                {tool.kind === "integration" && tool.integration && !app.integrations.some((c) => c.id === tool.integration && c.connected) ? <Badge tone="amber">Not connected</Badge> : <Badge>Connects at launch</Badge>}
                <button type="button" className="btn-icon h-7 w-7 hover:text-rose-600" aria-label={`Remove ${tool.name}`} onClick={() => onEdit((f) => ({ ...f, tools: f.tools.filter((t) => t.id !== tool.id) }))}>
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <AddToolSheet
        kind={adding}
        onClose={() => setAdding(null)}
        onAdd={(tool) => {
          onEdit((f) => ({ ...f, tools: [...f.tools, tool] }));
          setAdding(null);
        }}
      />
    </div>
  );
}

function AddToolSheet({ kind, onClose, onAdd }: { kind: AgentTool["kind"] | null; onClose: () => void; onAdd: (tool: AgentTool) => void }) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const ok = name.trim() && /^https?:\/\/\S+$/.test(url.trim());
  const reset = () => {
    setName("");
    setUrl("");
    setDescription("");
  };
  return (
    <Sheet
      open={kind !== null}
      onClose={() => {
        reset();
        onClose();
      }}
      title={kind === "mcp" ? "Add an MCP server" : "Add an API request"}
      footer={
        <button
          type="button"
          className="btn-primary w-full"
          disabled={!ok}
          onClick={() => {
            if (!kind) return;
            onAdd({ id: newId("t"), kind, name: name.trim(), url: url.trim(), description: description.trim() });
            reset();
          }}
        >
          Add
        </button>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-fg-3">Saved with the agent now. It connects when tools launch; nothing is called until then.</p>
        <Field label="Name">
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === "mcp" ? "Inventory" : "Order status"} />
        </Field>
        <Field label={kind === "mcp" ? "Server address" : "Endpoint"}>
          <input className="field font-mono text-sm" value={url} onChange={(e) => setUrl(e.target.value)} placeholder={kind === "mcp" ? "https://mcp.example.com/mcp" : "https://api.example.com/orders/{order_id}"} inputMode="url" />
        </Field>
        <Field label="When should the agent use it?">
          <textarea className="field min-h-20" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="When a caller asks whether a car is in stock." />
        </Field>
      </div>
    </Sheet>
  );
}
