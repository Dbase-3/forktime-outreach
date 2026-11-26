"use client";

// Duplicate or delete an agent (audit: neither existed). A copy starts as a
// draft without a number (numbers belong to one agent). Deleting asks first,
// and is refused while a running campaign uses the agent; its number is freed
// and past calls keep their history.

import { Copy, MoreHorizontal, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { deleteAgent, duplicateAgent as duplicateOnServer } from "@/lib/actions";
import { useApp } from "@/lib/store";
import type { Flow } from "@outreach/core/types";
import { Popover } from "../popover";


export function AgentMenu({ flow, afterDelete }: { flow: Flow; afterDelete?: () => void }) {
  const app = useApp();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const running = app.campaigns.filter((c) => c.status === "running" && c.agentId === flow.id);

  const [error, setError] = useState<string | null>(null);
  const duplicate = async () => {
    try {
      const copy = await duplicateOnServer(flow.id);
      setOpen(false);
      router.push(`/agents/${copy.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't duplicate it.");
    }
  };
  const remove = async () => {
    try {
      await deleteAgent(flow.id);
      setOpen(false);
      afterDelete?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't delete it.");
    }
  };

  return (
    <Popover
      align="end"
      className="w-64 p-1.5"
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setConfirming(false);
      }}
      trigger={
        <button type="button" className="btn-icon h-8 w-8" aria-label={`More for ${flow.name}`} onClick={(e) => e.stopPropagation()}>
          <MoreHorizontal size={16} />
        </button>
      }
    >
      {error && <p className="px-2.5 pb-1.5 text-xs text-rose-700 dark:text-rose-400">{error}</p>}
      {!confirming ? (
        <div onClick={(e) => e.stopPropagation()}>
          <button type="button" onClick={() => void duplicate()} className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-muted">
            <Copy size={14} className="text-fg-3" /> Duplicate
          </button>
          <button type="button" onClick={() => setConfirming(true)} className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-rose-700 hover:bg-rose-500/10 dark:text-rose-400">
            <Trash2 size={14} /> Delete
          </button>
        </div>
      ) : (
        <div className="p-1.5" onClick={(e) => e.stopPropagation()}>
          {running.length > 0 ? (
            <>
              <div className="text-sm font-medium">Can&apos;t delete while it&apos;s calling</div>
              <p className="mt-1 text-xs text-fg-3">Pause or finish {running.map((c) => `“${c.name}”`).join(", ")} first.</p>
              <div className="mt-3 flex justify-end">
                <button type="button" className="btn-ghost h-8 px-3 text-sm" onClick={() => setConfirming(false)}>OK</button>
              </div>
            </>
          ) : (
            <>
              <div className="text-sm font-medium">Delete {flow.name}?</div>
              <p className="mt-1 text-xs text-fg-3">Its number is freed for another agent. Past calls keep their recordings and transcripts.</p>
              <div className="mt-3 flex justify-end gap-2">
                <button type="button" className="btn-ghost h-8 px-3 text-sm" onClick={() => setConfirming(false)}>Keep</button>
                <button type="button" className="h-8 rounded-lg bg-rose-600 px-3 text-sm font-medium text-white hover:bg-rose-700" onClick={() => void remove()}>Delete</button>
              </div>
            </>
          )}
        </div>
      )}
    </Popover>
  );
}
