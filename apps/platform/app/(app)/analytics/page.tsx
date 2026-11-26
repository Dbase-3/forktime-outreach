"use client";

// Analytics (owner 2026-11-26, after Dialora's page): one set of filters on top,
// headline figures with the change from the period before, then where calls
// went, how agents do, how conversations went, and when to call.

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { useMemo, useState } from "react";
import { RANGES, change, type AgentRow, type RangeId, type TimeMetric, type conversation, type directions, type pickupBreakdown, type summarize, type timeline, type topOutcomes, type transfers, type bestTimes } from "@outreach/core/analytics";
import { currentWorkspace, ws } from "@/lib/api";
import { useApp } from "@/lib/store";
import { AreaChart, Legend, type Series } from "@/components/charts";
import { PageHeader, Segmented } from "@/components/ui";
import { AgentTable, BestTime, Directions, Kpis, Outcomes, Panel, PickupCard, TierCard, TransferCard } from "@/components/analytics/sections";
import { ENGAGEMENT_TIERS, LEAD_TIERS, MOOD_TIERS } from "@outreach/core/analytics";

type Dir = "all" | "outbound" | "inbound";

const SERIES: Series[] = [
  { key: "calls", label: "Calls", color: "rgb(var(--series-1))" },
  { key: "wins", label: "Did its job", color: "rgb(var(--series-2))" },
];

/** What POST /analytics returns: every figure on the page, worked out on the server. */
type Figures = {
  bounds: { from: number; to: number; prevFrom: number; prevTo: number };
  now: { summary: ReturnType<typeof summarize>; conversation: ReturnType<typeof conversation> };
  was: { summary: ReturnType<typeof summarize>; conversation: ReturnType<typeof conversation> };
  buckets: ReturnType<typeof timeline>;
  pickup: ReturnType<typeof pickupBreakdown>;
  byAgent: { flowId: string; summary: AgentRow["summary"]; trend: number[] }[];
  outcomes: ReturnType<typeof topOutcomes>;
  directions: ReturnType<typeof directions>;
  transfers: ReturnType<typeof transfers>;
  bestTimes: ReturnType<typeof bestTimes>;
  languages: string[];
};

export default function AnalyticsPage() {
  const app = useApp();
  const now = useMemo(() => new Date(), []);
  const [range, setRange] = useState<RangeId>("30d");
  const [flowId, setFlowId] = useState("");
  const [dir, setDir] = useState<Dir>("all");
  const [language, setLanguage] = useState("");
  const [metric, setMetric] = useState<TimeMetric>("pickup");

  const languages = useMemo(() => [...new Set(app.flows.map((f) => f.agent.language))].sort(), [app.flows]);
  const body = { range, agentId: flowId, direction: dir, language, metric };
  const figures = useQuery({ queryKey: ["analytics", app.workspace.id, body], queryFn: () => ws<Figures>("/analytics", { body }), placeholderData: keepPreviousData });
  const [exporting, setExporting] = useState(false);
  const f = figures.data;
  if (!f) {
    return (
      <div className="space-y-4">
        <PageHeader title="Analytics" subtitle="How your agents are doing, and when people pick up." />
        {figures.isError ? (
          <p className="text-sm text-fg-2">Couldn&apos;t load the figures. <button type="button" className="text-accent hover:underline" onClick={() => void figures.refetch()}>Try again</button></p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <span key={i} className="skeleton block h-24 rounded-xl" />)}</div>
        )}
      </div>
    );
  }
  const bounds = f.bounds;
  const now$ = f.now.summary;
  const was = f.was.summary;
  const conv = f.now.conversation;
  const convBefore = f.was.conversation;
  const buckets = f.buckets;
  const agentRows: AgentRow[] = f.byAgent.flatMap((r) => {
    const flow = app.flows.find((x) => x.id === r.flowId);
    return flow ? [{ flow, summary: r.summary, trend: r.trend }] : [];
  });
  const points = buckets.map((b) => ({ label: b.label, tick: b.tick, values: { calls: b.calls, wins: b.wins } }));
  const qualified = conv.leads.rows.find((r) => r.id === "qualified")?.count ?? 0;
  const qualifiedBefore = convBefore.leads.rows.find((r) => r.id === "qualified")?.count ?? 0;
  const upset = conv.mood.total ? (conv.mood.rows.find((r) => r.id === "upset")?.count ?? 0) / conv.mood.total : null;
  const upsetBefore = convBefore.mood.total ? (convBefore.mood.rows.find((r) => r.id === "upset")?.count ?? 0) / convBefore.mood.total : null;
  const rangeLabel = RANGES.find((r) => r.id === range)?.label ?? "";
  const dates = `${new Date(bounds.from).toLocaleDateString("en-AU", { day: "numeric", month: "short" })} – ${now.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}`;

  const exportCsv = async () => {
    setExporting(true);
    try {
      const res = await fetch(`/api/v1/w/${currentWorkspace()}/analytics/export`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
      if (!res.ok) throw new Error("Couldn't export.");
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `calls-${range}-${now.toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Analytics"
        subtitle="How your agents are doing, and when people pick up."
        actions={<button type="button" className="btn-secondary" onClick={() => void exportCsv()} disabled={now$.calls === 0 || exporting}><Download size={15} /> {exporting ? "Exporting…" : "Export CSV"}</button>}
      />

      {/* Filters: one row, applied to everything below */}
      <div className="flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:flex">
          <select className="field lg:w-44" value={range} onChange={(e) => setRange(e.target.value as RangeId)} aria-label="Date range">
            {RANGES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
          <select className="field lg:w-48" value={flowId} onChange={(e) => setFlowId(e.target.value)} aria-label="Agent">
            <option value="">All agents</option>
            {app.flows.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
          <select className="field lg:w-40" value={language} onChange={(e) => setLanguage(e.target.value)} aria-label="Language">
            <option value="">All languages</option>
            {languages.map((l) => <option key={l}>{l}</option>)}
          </select>
        </div>
        <Segmented<Dir> value={dir} onChange={setDir} options={[{ value: "all", label: "All calls" }, { value: "outbound", label: "We called" }, { value: "inbound", label: "Called in" }]} />
        <span className="font-mono text-xs text-fg-3 lg:ml-auto">{figures.isFetching && <span className="mr-2 text-fg-4">Updating…</span>}{dates}</span>
      </div>

      <Kpis
        compareTo={range === "today" ? "yesterday" : range === "ytd" ? "the same span before" : `the ${rangeLabel.replace("Last ", "previous ")}`}
        items={[
          { label: "Calls", value: String(now$.calls), delta: change(now$.calls, was.calls, "count"), kind: "count", good: "up" },
          { label: "Picked up", value: pct(now$.answerRate), delta: change(now$.answerRate, was.answerRate, "rate"), kind: "rate", good: "up", sub: "of calls we made" },
          { label: "Did its job", value: pct(now$.winRate), delta: change(now$.winRate, was.winRate, "rate"), kind: "rate", good: "up", sub: "booked, sorted or passed on" },
          { label: "Average call", value: now$.avgSec === null ? "—" : clock(now$.avgSec), delta: change(now$.avgSec, was.avgSec, "count"), kind: "count", good: "neutral" },
          { label: "Staff time saved", value: hours(now$.talkSec), delta: change(now$.talkSec, was.talkSec, "count"), kind: "count", good: "up", sub: "time on the phone, handled" },
          { label: "Qualified leads", value: String(qualified), delta: change(qualified, qualifiedBefore, "count"), kind: "count", good: "up" },
          { label: "Transferred", value: pct(now$.transferRate), delta: change(now$.transferRate, was.transferRate, "rate"), kind: "rate", good: "neutral", sub: `${now$.transfers} calls` },
          { label: "Upset callers", value: pct(upset), delta: change(upset, upsetBefore, "rate"), kind: "rate", good: "down" },
        ]}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Calls over time" className="lg:col-span-2" action={<Legend series={SERIES} totals={{ calls: now$.calls, wins: now$.wins }} />}>
          {now$.calls === 0 ? <Empty /> : <AreaChart points={points} series={SERIES} height={240} />}
        </Panel>
        <PickupCard data={f.pickup} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="By agent" className="lg:col-span-2" flush>
          <AgentTable rows={agentRows} />
        </Panel>
        <Outcomes rows={f.outcomes} />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <TierCard title="Lead quality" tiers={LEAD_TIERS} data={conv.leads} />
        <TierCard title="Engagement" tiers={ENGAGEMENT_TIERS} data={conv.engagement} />
        <TierCard title="Caller mood" tiers={MOOD_TIERS} data={conv.mood} />
      </div>

      <BestTime regions={f.bestTimes} metric={metric} onMetric={setMetric} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Directions data={f.directions} />
        <TransferCard data={f.transfers} />
      </div>
    </div>
  );
}

function Empty() {
  return <p className="py-10 text-center text-sm text-fg-3">No calls in this range. Try a longer range or clear a filter.</p>;
}

function pct(v: number | null): string {
  return v === null ? "—" : `${Math.round(v * 100)}%`;
}

function clock(sec: number): string {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

function hours(sec: number): string {
  const m = Math.round(sec / 60);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}
