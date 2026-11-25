"use client";

import { ArrowDownLeft, ArrowUpRight, PhoneCall, Search, ThumbsDown, ThumbsUp } from "lucide-react";
import { useMemo, useState } from "react";
import { CALL_ACTIONS } from "@/lib/call-review";
import { duration, humanize, relativeTime } from "@/lib/format";
import { useApp } from "@/lib/store";
import type { AppState, Call } from "@/lib/types";
import { CallSheet, outcomeTone } from "@/components/call-sheet";
import { Avatar, Badge, EmptyState, PageHeader, Segmented } from "@/components/ui";

type Direction = "all" | "inbound" | "outbound";

export default function CallsPage() {
  const app = useApp();
  const [direction, setDirection] = useState<Direction>("all");
  const [query, setQuery] = useState("");
  const [flowId, setFlowId] = useState("");
  const [outcome, setOutcome] = useState("");
  const [action, setAction] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const outcomes = useMemo(() => [...new Set(app.calls.map((c) => c.outcome))].sort(), [app.calls]);
  const q = query.trim().toLowerCase();
  const calls = [...app.calls]
    .filter((c) => direction === "all" || c.direction === direction)
    .filter((c) => !flowId || c.flowId === flowId)
    .filter((c) => !outcome || c.outcome === outcome)
    .filter((c) => !action || (c.actions ?? []).includes(action))
    .filter((c) => {
      if (!q) return true;
      const contact = app.contacts.find((x) => x.id === c.contactId);
      return `${contact?.name ?? ""} ${contact?.phone ?? ""} ${c.summary}`.toLowerCase().includes(q);
    })
    .sort((a, b) => Number(Boolean(b.live)) - Number(Boolean(a.live)) || b.startedAt.localeCompare(a.startedAt));
  const filtered = Boolean(q || flowId || outcome || action || direction !== "all");
  const open = app.calls.find((c) => c.id === openId) ?? null;
  const clear = () => {
    setQuery("");
    setFlowId("");
    setOutcome("");
    setAction("");
    setDirection("all");
  };

  return (
    <div>
      <PageHeader title="Calls" subtitle="Listen back, read the transcript, see what was saved and rate how the agent did." />
      <div className="mb-4 space-y-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative lg:w-72">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-4" />
            <input className="field pl-9" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, number or summary" />
          </div>
          <Segmented<Direction>
            value={direction}
            onChange={setDirection}
            options={[
              { value: "all", label: "All" },
              { value: "outbound", label: "We called" },
              { value: "inbound", label: "Called in" },
            ]}
          />
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:w-[640px]">
          <select className="field" value={flowId} onChange={(e) => setFlowId(e.target.value)} aria-label="Agent">
            <option value="">All agents</option>
            {app.flows.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
          <select className="field" value={outcome} onChange={(e) => setOutcome(e.target.value)} aria-label="Outcome">
            <option value="">All outcomes</option>
            {outcomes.map((o) => <option key={o} value={o}>{humanize(o)}</option>)}
          </select>
          <select className="field" value={action} onChange={(e) => setAction(e.target.value)} aria-label="What the call did">
            <option value="">Anything it did</option>
            {Object.entries(CALL_ACTIONS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </div>
      </div>

      {calls.length === 0 ? (
        <EmptyState
          icon={<PhoneCall size={20} />}
          title={filtered ? "No calls match" : "No calls yet"}
          body={filtered ? "Try another search or filter." : "Calls show up here as they happen."}
          action={filtered ? <button type="button" className="btn-secondary" onClick={clear}>Clear filters</button> : undefined}
        />
      ) : (
        <>
          <p className="mb-2 text-xs text-fg-3">{calls.length} {calls.length === 1 ? "call" : "calls"}</p>
          <div className="card divide-y divide-line overflow-hidden">
            {calls.map((call) => (
              <CallRow key={call.id} call={call} app={app} onOpen={() => setOpenId(call.id)} />
            ))}
          </div>
        </>
      )}
      <CallSheet call={open} app={app} onClose={() => setOpenId(null)} />
    </div>
  );
}

function CallRow({ call, app, onOpen }: { call: Call; app: AppState; onOpen: () => void }) {
  const contact = app.contacts.find((c) => c.id === call.contactId);
  const flow = app.flows.find((f) => f.id === call.flowId);
  const DirIcon = call.direction === "inbound" ? ArrowDownLeft : ArrowUpRight;
  return (
    <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-subtle">
      <Avatar name={contact?.name ?? "?"} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 font-medium">
          <span className="truncate">{contact?.name ?? "Unknown caller"}</span>
          <DirIcon size={14} className="shrink-0 text-fg-4" />
          {call.feedback?.rating === "up" && <ThumbsUp size={13} className="shrink-0 text-emerald-600" aria-label="Rated good" />}
          {call.feedback?.rating === "down" && <ThumbsDown size={13} className="shrink-0 text-rose-600" aria-label="Rated poor" />}
        </span>
        <span className="block truncate text-sm text-fg-2">{call.summary}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-fg-3">
          <span>{flow?.name}</span>
          <span>· {call.live ? "in progress" : duration(call.durationSec)}</span>
          {(call.actions ?? []).map((a) => (
            <span key={a}>· {CALL_ACTIONS[a] ?? a}</span>
          ))}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1.5">
        {call.live ? <Badge tone="green" dot>Live</Badge> : <Badge tone={outcomeTone(call.outcome)}>{humanize(call.outcome)}</Badge>}
        <span className="text-xs text-fg-3">{call.live ? "Now" : relativeTime(call.startedAt)}</span>
      </span>
    </button>
  );
}
