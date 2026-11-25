"use client";

// The documents this agent answers from: those attached to it, plus every
// document available to all agents. Attach more from the library, or add new.

import { BookOpen, FileUp, Globe, Plus, Type, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { formatBytes } from "@/lib/knowledge";
import { useApp } from "@/lib/store";
import type { Flow } from "@/lib/types";
import { toggleAttached } from "../knowledge/actions";
import { AddKnowledgeSheet, type AddKind } from "../knowledge/add-sheets";
import { DocIcon, DocStatus } from "../knowledge/doc-status";
import { Popover } from "../popover";

export function KnowledgeTab({ flow }: { flow: Flow }) {
  const app = useApp();
  const [adding, setAdding] = useState<AddKind | null>(null);
  const attached = app.knowledge.filter((d) => !d.availableToAll && flow.knowledgeIds.includes(d.id));
  const shared = app.knowledge.filter((d) => d.availableToAll);
  const others = app.knowledge.filter((d) => !d.availableToAll && !flow.knowledgeIds.includes(d.id));

  return (
    <div className="space-y-5 p-4">
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-medium">This agent&rsquo;s documents</h3>
          <div className="flex items-center gap-1">
            {others.length > 0 && (
              <Popover align="end" className="w-72" trigger={<button type="button" className="btn-ghost h-7 px-2 text-xs"><BookOpen size={13} /> From library</button>}>
                <div className="mb-1 text-sm font-medium">Attach from the library</div>
                {others.map((d) => (
                  <button key={d.id} type="button" onClick={() => toggleAttached(d.id, flow.id, true)} className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-muted">
                    <DocIcon doc={d} size={14} /> <span className="min-w-0 flex-1 truncate">{d.name}</span> <Plus size={13} className="text-fg-4" />
                  </button>
                ))}
              </Popover>
            )}
            <Popover align="end" className="w-56" trigger={<button type="button" className="btn-ghost h-7 px-2 text-xs"><Plus size={13} /> New</button>}>
              {[{ kind: "url" as const, label: "Web address", icon: Globe }, { kind: "files" as const, label: "Files", icon: FileUp }, { kind: "text" as const, label: "Text", icon: Type }].map(({ kind, label, icon: Icon }) => (
                <button key={kind} type="button" onClick={() => setAdding(kind)} className="flex h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-muted"><Icon size={14} className="text-fg-3" /> {label}</button>
              ))}
            </Popover>
          </div>
        </div>
        {attached.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line-strong px-3 py-4 text-center text-sm text-fg-3">Nothing attached yet.</p>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {attached.map((d) => (
              <li key={d.id} className="flex items-center gap-2.5 px-3 py-2">
                <DocIcon doc={d} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{d.name}</span>
                  <span className="block text-xs text-fg-3">{d.sizeBytes ? formatBytes(d.sizeBytes) : "—"}</span>
                </span>
                <DocStatus doc={d} />
                <button type="button" className="btn-icon h-7 w-7" onClick={() => toggleAttached(d.id, flow.id, false)} aria-label={`Detach ${d.name}`}><X size={14} /></button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {shared.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-medium">Available to every agent</h3>
          <ul className="divide-y divide-line rounded-lg border border-line">
            {shared.map((d) => (
              <li key={d.id} className="flex items-center gap-2.5 px-3 py-2">
                <DocIcon doc={d} />
                <span className="min-w-0 flex-1 truncate text-sm">{d.name}</span>
                <DocStatus doc={d} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-xs text-fg-3">The agent answers only from these and says so when something isn&rsquo;t covered. <Link href="/knowledge" className="text-accent hover:underline">Open the library</Link></p>
      <AddKnowledgeSheet kind={adding} onClose={() => setAdding(null)} attachTo={flow.id} />
    </div>
  );
}
