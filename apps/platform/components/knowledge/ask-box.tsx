"use client";

// "What would the agent find?" Type a question a caller might ask and see the
// passages an agent gets back (the same search agents use on calls), from
// every document or only what one agent can use.

import { useQuery } from "@tanstack/react-query";
import { MessageCircleQuestion } from "lucide-react";
import { useEffect, useState } from "react";
import { ws } from "@/lib/api";
import { useApp } from "@/lib/store";

type Passage = { docId: string; docName: string; heading: string; text: string; score: number };

export function AskBox({ onOpen }: { onOpen: (docId: string) => void }) {
  const app = useApp();
  const [typed, setTyped] = useState("");
  const [query, setQuery] = useState("");
  const [agentId, setAgentId] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQuery(typed.trim()), 350);
    return () => clearTimeout(t);
  }, [typed]);
  const hits = useQuery({
    queryKey: ["knowledge-search", app.workspace.id, query, agentId],
    queryFn: () => ws<Passage[]>("/knowledge/search", { body: { query, agentId: agentId || undefined, limit: 3 } }),
    enabled: query.length >= 3,
  });

  return (
    <div className="card mb-5 p-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <MessageCircleQuestion size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-4" />
          <input className="field pl-9" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Test a question a caller might ask, e.g. do you have loan cars?" aria-label="Test a question" />
        </div>
        <select className="field sm:w-48" value={agentId} onChange={(e) => setAgentId(e.target.value)} aria-label="As which agent">
          <option value="">Any agent</option>
          {app.flows.map((f) => <option key={f.id} value={f.id}>As {f.name}</option>)}
        </select>
      </div>
      {query.length >= 3 && (
        <div className="mt-3 space-y-2">
          {hits.isLoading && <span className="skeleton block h-14 rounded-lg" />}
          {hits.isError && <p className="text-sm text-rose-700 dark:text-rose-400">{hits.error instanceof Error ? hits.error.message : "Couldn't search."}</p>}
          {hits.data?.length === 0 && <p className="text-sm text-fg-3">Nothing answers that{agentId ? " for this agent" : ""}. Add a document that covers it{agentId ? ", or attach one" : ""}.</p>}
          {hits.data?.map((h, i) => (
            <button key={`${h.docId}-${i}`} type="button" onClick={() => onOpen(h.docId)} className="block w-full rounded-lg bg-subtle p-3 text-left transition-colors hover:bg-muted">
              <span className="flex items-baseline justify-between gap-3">
                <span className="truncate text-sm font-medium">{h.docName}{h.heading ? <span className="font-normal text-fg-3"> · {h.heading}</span> : null}</span>
                {i === 0 && <span className="shrink-0 font-mono text-2xs uppercase tracking-[0.08em] text-fg-3">Best match</span>}
              </span>
              <span className="mt-1 line-clamp-3 block whitespace-pre-line text-sm text-fg-2">{h.text}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
