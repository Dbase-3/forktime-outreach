"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowDownLeft, ArrowUpRight, ChevronLeft, ChevronRight, PhoneCall, Search, ThumbsDown, ThumbsUp } from "lucide-react";
import { useEffect, useState } from "react";
import { CALL_ACTIONS } from "@outreach/core/call-review";
import { duration, humanize, relativeTime } from "@outreach/core/format";
import { ws } from "@/lib/api";
import { useApp } from "@/lib/store";
import type { Call, Flow } from "@outreach/core/types";
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
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");

  // Search waits for a pause in typing; any filter change goes back to page 1.
  useEffect(() => {
    const t = setTimeout(() => setSearch(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);
  useEffect(() => setPage(1), [search, direction, flowId, outcome, action]);
  // Links (Home, ⌘K) open a call with ?open=<id>.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("open");
    if (id) setOpenId(id);
  }, []);

  const body = { search, direction, agentId: flowId, outcome, action, page, pageSize: 50 };
  const list = useQuery({
    queryKey: ["calls", app.workspace.id, body],
    queryFn: () => ws<{ rows: Call[]; contacts: Record<string, Person>; total: number; pages: number }>("/calls/query", { body }),
    placeholderData: keepPreviousData,
    refetchInterval: (q) => (q.state.data?.rows.some((c) => c.live) ? 5000 : false),
  });
  const outcomesQuery = useQuery({ queryKey: ["call-outcomes", app.workspace.id], queryFn: () => ws<string[]>("/calls/outcomes") });
  const outcomes = outcomesQuery.data ?? [];
  const calls = list.data?.rows ?? [];
  const people = list.data?.contacts ?? {};
  const total = list.data?.total ?? 0;
  const pages = list.data?.pages ?? 1;
  const filtered = Boolean(search || flowId || outcome || action || direction !== "all");
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

      {list.isLoading ? (
        <div className="card divide-y divide-line overflow-hidden">{Array.from({ length: 6 }, (_, i) => <div key={i} className="px-4 py-4"><span className="skeleton block h-10 rounded-lg" /></div>)}</div>
      ) : list.isError ? (
        <EmptyState icon={<PhoneCall size={20} />} title="Couldn't load calls" body={list.error instanceof Error ? list.error.message : "Try again in a moment."} action={<button type="button" className="btn-secondary" onClick={() => void list.refetch()}>Try again</button>} />
      ) : calls.length === 0 ? (
        <EmptyState
          icon={<PhoneCall size={20} />}
          title={filtered ? "No calls match" : "No calls yet"}
          body={filtered ? "Try another search or filter." : "Calls show up here as they happen."}
          action={filtered ? <button type="button" className="btn-secondary" onClick={clear}>Clear filters</button> : undefined}
        />
      ) : (
        <>
          <p className="mb-2 text-xs text-fg-3">
            {total.toLocaleString()} {total === 1 ? "call" : "calls"}
            {list.isFetching && <span className="ml-2 text-fg-4">Updating…</span>}
          </p>
          <div className="card divide-y divide-line overflow-hidden">
            {calls.map((call) => (
              <CallRow key={call.id} call={call} person={call.contactId ? people[call.contactId] : undefined} flows={app.flows} onOpen={() => setOpenId(call.id)} />
            ))}
          </div>
          {pages > 1 && (
            <div className="mt-3 flex items-center justify-end gap-2 text-sm">
              <span className="text-xs text-fg-3">Page {page} of {pages.toLocaleString()}</span>
              <button type="button" className="btn-icon h-8 w-8" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Previous page"><ChevronLeft size={15} /></button>
              <button type="button" className="btn-icon h-8 w-8" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} aria-label="Next page"><ChevronRight size={15} /></button>
            </div>
          )}
        </>
      )}
      <CallSheet callId={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}

type Person = { id: string; name: string; phone: string };

function CallRow({ call, person: contact, flows, onOpen }: { call: Call; person?: Person; flows: Flow[]; onOpen: () => void }) {
  const flow = flows.find((f) => f.id === call.flowId);
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
          <span>{flow?.name ?? "Deleted agent"}</span>
          {call.test && <span>· Test call</span>}
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
