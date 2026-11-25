"use client";

import clsx from "clsx";
import { ArrowDownLeft, ArrowUpRight, ArrowLeftRight, FilePlus2, Plus, Workflow } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { countSteps } from "@/lib/flow-tree";
import { relativeTime } from "@/lib/format";
import { update, useApp } from "@/lib/store";
import { TEMPLATES, flowFromTemplate, type FlowTemplate } from "@/lib/templates";
import { voiceById } from "@/lib/voices";
import type { Direction } from "@/lib/types";
import { Avatar, Badge, EmptyState, PageHeader, Sheet } from "@/components/ui";

const DIRECTION = {
  outbound: { label: "Calls we make", icon: ArrowUpRight },
  inbound: { label: "Calls we answer", icon: ArrowDownLeft },
  both: { label: "Both ways", icon: ArrowLeftRight },
} satisfies Record<Direction, { label: string; icon: unknown }>;

export default function FlowsPage() {
  const { flows, calls } = useApp();
  const [picking, setPicking] = useState(false);
  const newButton = (
    <button type="button" className="btn-primary" onClick={() => setPicking(true)}>
      <Plus size={16} /> New flow
    </button>
  );

  return (
    <div>
      <PageHeader title="Flows" subtitle="What your agent does on a call, step by step." actions={newButton} />
      {flows.length === 0 ? (
        <EmptyState icon={<Workflow size={22} />} title="No flows yet" body="Start from a template or a blank flow. You can change everything later." action={newButton} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {flows.map((flow) => {
            const dir = DIRECTION[flow.direction];
            const DirIcon = dir.icon;
            const callCount = calls.filter((c) => c.flowId === flow.id).length;
            return (
              <Link key={flow.id} href={`/flows/${flow.id}`} className="card group flex flex-col p-4 transition hover:border-zinc-300 hover:shadow-md">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate font-semibold">{flow.name}</h3>
                    <p className="mt-0.5 line-clamp-2 text-sm text-zinc-500">{flow.description || "No description"}</p>
                  </div>
                  <Badge tone={flow.status === "live" ? "green" : "gray"} dot>{flow.status === "live" ? "Live" : "Draft"}</Badge>
                </div>
                <div className="mt-4 flex items-center gap-2.5 border-t border-zinc-100 pt-3 text-xs text-zinc-500">
                  <Avatar name={flow.agent.name} className="h-6 w-6 text-[10px]" />
                  <span className="truncate">{flow.agent.name} · {voiceById(flow.agent.voiceId).accent}</span>
                  <span className="ml-auto flex shrink-0 items-center gap-1">
                    <DirIcon size={13} /> {dir.label}
                  </span>
                </div>
                <div className="mt-2 flex gap-3 text-xs text-zinc-400">
                  <span>{countSteps(flow.steps)} steps</span>
                  <span>{callCount} calls</span>
                  <span className="ml-auto">Edited {relativeTime(flow.updatedAt)}</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
      <NewFlowSheet open={picking} onClose={() => setPicking(false)} />
    </div>
  );
}

function NewFlowSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const create = (template: FlowTemplate | null) => {
    const flow = flowFromTemplate(template);
    update((s) => ({ ...s, flows: [flow, ...s.flows] }));
    onClose();
    router.push(`/flows/${flow.id}`);
  };
  return (
    <Sheet open={open} onClose={onClose} title="New flow" wide>
      <button type="button" onClick={() => create(null)} className="card mb-5 flex w-full items-center gap-3 border-dashed p-4 text-left transition hover:border-brand-300">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-100 text-zinc-600">
          <FilePlus2 size={18} />
        </span>
        <span>
          <span className="block text-sm font-semibold">Start blank</span>
          <span className="block text-xs text-zinc-500">Build it step by step</span>
        </span>
      </button>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">Or start from a template</h3>
      <div className="grid gap-2.5 sm:grid-cols-2">
        {TEMPLATES.map((template) => {
          const DirIcon = DIRECTION[template.direction].icon;
          return (
            <button key={template.id} type="button" onClick={() => create(template)} className="card flex flex-col items-start p-4 text-left transition hover:border-brand-300 hover:shadow-md">
              <span className="flex w-full items-center justify-between">
                <span className="text-sm font-semibold">{template.name}</span>
                <DirIcon size={14} className={clsx("text-zinc-400")} />
              </span>
              <span className="mt-1 text-xs leading-relaxed text-zinc-500">{template.blurb}</span>
              <span className="mt-3">
                <Badge>{template.category}</Badge>
              </span>
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}
