"use client";

import clsx from "clsx";
import { ArrowDownLeft, ArrowLeftRight, ArrowRight, ArrowUpRight, FilePlus2, Plus, Search, Workflow } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { relativeTime } from "@outreach/core/format";
import { agentStats } from "@outreach/core/stats";
import { useApp } from "@/lib/store";
import { TEMPLATES, type FlowTemplate } from "@outreach/core/templates";
import { voiceById } from "@outreach/core/voices";
import type { Direction } from "@outreach/core/types";
import { Avatar, Badge, EmptyState, PageHeader, Sheet } from "@/components/ui";
import { CreateAgentModal } from "@/components/agent/create-agent-modal";
import { AgentMenu } from "@/components/agent/agent-menu";

const DIRECTION: Record<Direction, { label: string; icon: typeof ArrowUpRight }> = {
  outbound: { label: "Makes calls", icon: ArrowUpRight },
  inbound: { label: "Answers calls", icon: ArrowDownLeft },
  both: { label: "Both ways", icon: ArrowLeftRight },
};

export default function AgentsPage() {
  const { flows, calls, numbers } = useApp();
  const router = useRouter();
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState("");
  const now = new Date();

  // Home's "Create an agent" links here with ?new=1.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("new") === "1") setPicking(true);
  }, []);

  // Scratch or a template: name it and pick its number first (CreateAgentModal), then open it.
  const [creating, setCreating] = useState<{ template: FlowTemplate | null } | null>(null);
  const create = (template: FlowTemplate | null) => {
    setPicking(false);
    setCreating({ template });
  };
  const q = query.trim().toLowerCase();
  const shown = flows.filter((f) => !q || `${f.name} ${f.description} ${f.agent.name}`.toLowerCase().includes(q));
  const newButton = (
    <button type="button" className="btn-primary" onClick={() => setPicking(true)}>
      <Plus size={15} /> New agent
    </button>
  );

  return (
    <div>
      <PageHeader title="Agents" subtitle="Each agent has a voice, a workflow, what it knows and what it collects." actions={newButton} />

      <div className="mb-5 rounded-xl border border-line bg-surface p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium">Start from a template</h2>
          <button type="button" className="flex items-center gap-1 text-xs text-fg-3 hover:text-fg" onClick={() => setPicking(true)}>All templates <ArrowRight size={12} /></button>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          {TEMPLATES.slice(0, 3).map((t) => (
            <button key={t.id} type="button" onClick={() => create(t)} className="rounded-lg border border-line p-3 text-left transition-colors hover:border-line-strong hover:bg-subtle">
              <span className="block text-sm font-medium">{t.name}</span>
              <span className="mt-0.5 line-clamp-2 block text-xs text-fg-3">{t.blurb}</span>
            </button>
          ))}
        </div>
      </div>

      {flows.length === 0 ? (
        <EmptyState icon={<Workflow size={20} />} title="No agents yet" body="Start from scratch or from a template. You can change everything later." action={newButton} />
      ) : (
        <>
          <div className="relative mb-3 sm:w-72">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-4" />
            <input className="field pl-9" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search agents" />
          </div>
          <div className="card overflow-hidden">
            <table className="w-full table-fixed text-sm">
              <thead className="bg-subtle/60 text-left">
                <tr>
                  <th className="metric-label px-4 py-2.5 font-normal">Name</th>
                  <th className="metric-label hidden w-44 px-4 py-2.5 font-normal md:table-cell">Voice</th>
                  <th className="metric-label hidden w-40 px-4 py-2.5 font-normal xl:table-cell">Number</th>
                  <th className="metric-label hidden w-36 px-4 py-2.5 font-normal lg:table-cell">Used for</th>
                  <th className="metric-label hidden w-24 px-4 py-2.5 text-right font-normal sm:table-cell">7d calls</th>
                  <th className="metric-label hidden w-28 px-4 py-2.5 font-normal lg:table-cell">Edited</th>
                  <th className="metric-label w-24 px-4 py-2.5 text-right font-normal">Status</th>
                  <th className="w-12 px-2 py-2.5"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {shown.map((flow) => {
                  const dir = DIRECTION[flow.direction];
                  const DirIcon = dir.icon;
                  const voice = voiceById(flow.agent.voiceId);
                  const number = numbers.find((n) => n.id === flow.numberId);
                  return (
                    <tr key={flow.id} onClick={() => router.push(`/agents/${flow.id}`)} className="cursor-pointer transition-colors hover:bg-subtle">
                      <td className="px-4 py-3">
                        <Link href={`/agents/${flow.id}`} className="block truncate font-medium" onClick={(e) => e.stopPropagation()}>{flow.name}</Link>
                        <span className="block truncate text-xs text-fg-3">{flow.description || "No description"}</span>
                      </td>
                      <td className="hidden px-4 py-3 md:table-cell">
                        <span className="flex items-center gap-2">
                          <Avatar name={flow.agent.name} className="h-6 w-6 text-2xs" />
                          <span className="truncate">{flow.agent.name} <span className="text-fg-3">· {voice.accent}</span></span>
                        </span>
                      </td>
                      <td className="hidden px-4 py-3 xl:table-cell">{number ? <span className="font-mono text-xs">{number.display}</span> : <span className="text-xs text-amber-700 dark:text-amber-400">No number yet</span>}</td>
                      <td className="hidden px-4 py-3 text-fg-2 lg:table-cell"><span className="flex items-center gap-1.5"><DirIcon size={13} className="text-fg-4" /> {dir.label}</span></td>
                      <td className="hidden px-4 py-3 text-right font-mono text-xs sm:table-cell">{agentStats(flow, calls, now).week}</td>
                      <td className="hidden px-4 py-3 text-fg-3 lg:table-cell">{relativeTime(flow.updatedAt)}</td>
                      <td className="px-4 py-3 text-right"><Badge tone={flow.status === "live" ? "green" : "gray"} dot>{flow.status === "live" ? "Live" : "Draft"}</Badge></td>
                      <td className="px-2 py-3 text-right" onClick={(e) => e.stopPropagation()}><AgentMenu flow={flow} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      <Sheet open={picking} onClose={() => setPicking(false)} title="New agent" size="lg">
        <button type="button" onClick={() => create(null)} className="mb-5 flex w-full items-center gap-3 rounded-xl border border-dashed border-line-strong p-3.5 text-left transition-colors hover:bg-subtle">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted text-fg-2"><FilePlus2 size={16} /></span>
          <span>
            <span className="block text-sm font-medium">Start from scratch</span>
            <span className="block text-xs text-fg-3">Describe it and AI writes the instructions and workflow, or build it yourself</span>
          </span>
        </button>
        <h3 className="eyebrow mb-2">Templates</h3>
        <div className="grid gap-2 sm:grid-cols-2">
          {TEMPLATES.map((t) => {
            const DirIcon = DIRECTION[t.direction].icon;
            return (
              <button key={t.id} type="button" onClick={() => create(t)} className={clsx("flex flex-col items-start rounded-xl border border-line p-3.5 text-left transition-colors hover:border-line-strong hover:bg-subtle")}>
                <span className="flex w-full items-center justify-between gap-2">
                  <span className="text-sm font-medium">{t.name}</span>
                  <DirIcon size={13} className="text-fg-4" />
                </span>
                <span className="mt-1 text-xs leading-relaxed text-fg-3">{t.blurb}</span>
                <span className="mt-2.5"><Badge>{t.category}</Badge></span>
              </button>
            );
          })}
        </div>
      </Sheet>
      <CreateAgentModal open={creating !== null} template={creating?.template ?? null} onClose={() => setCreating(null)} />
    </div>
  );
}
