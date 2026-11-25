"use client";

// Analytics (owner 2026-11-26, after Dialora's page): one set of filters on top,
// headline figures with the change from the period before, then where calls
// went, how agents do, how conversations went, and when to call.

import { Download } from "lucide-react";
import { useMemo, useState } from "react";
import {
  RANGES,
  bestTimes,
  byAgent,
  callsCsv,
  change,
  conversation,
  directions,
  pickCalls,
  pickupBreakdown,
  rangeBounds,
  summarize,
  timeline,
  topOutcomes,
  transfers,
  type CallFilter,
  type RangeId,
  type TimeMetric,
} from "@/lib/analytics";
import { useApp } from "@/lib/store";
import { AreaChart, Legend, type Series } from "@/components/charts";
import { PageHeader, Segmented } from "@/components/ui";
import { AgentTable, BestTime, Directions, Kpis, Outcomes, Panel, PickupCard, TierCard, TransferCard } from "@/components/analytics/sections";
import { ENGAGEMENT_TIERS, LEAD_TIERS, MOOD_TIERS } from "@/lib/analytics";

type Dir = "all" | "outbound" | "inbound";

const SERIES: Series[] = [
  { key: "calls", label: "Calls", color: "rgb(var(--series-1))" },
  { key: "wins", label: "Did its job", color: "rgb(var(--series-2))" },
];

export default function AnalyticsPage() {
  const app = useApp();
  const now = useMemo(() => new Date(), []);
  const [range, setRange] = useState<RangeId>("30d");
  const [flowId, setFlowId] = useState("");
  const [dir, setDir] = useState<Dir>("all");
  const [language, setLanguage] = useState("");
  const [metric, setMetric] = useState<TimeMetric>("pickup");

  const languages = useMemo(() => [...new Set(app.flows.map((f) => f.agent.language))].sort(), [app.flows]);
  const bounds = rangeBounds(range, now);
  const filter: CallFilter = { flowId: flowId || undefined, direction: dir === "all" ? undefined : dir, language: language || undefined };
  const calls = useMemo(() => pickCalls(app.calls, app.flows, bounds.from, bounds.to, filter), [app.calls, app.flows, bounds.from, bounds.to, filter.flowId, filter.direction, filter.language]); // eslint-disable-line react-hooks/exhaustive-deps
  const before = useMemo(() => pickCalls(app.calls, app.flows, bounds.prevFrom, bounds.prevTo, filter), [app.calls, app.flows, bounds.prevFrom, bounds.prevTo, filter.flowId, filter.direction, filter.language]); // eslint-disable-line react-hooks/exhaustive-deps

  const now$ = summarize(calls);
  const was = summarize(before);
  const conv = conversation(calls);
  const convBefore = conversation(before);
  const buckets = timeline(calls, bounds.from, bounds.to);
  const points = buckets.map((b) => ({ label: b.label, tick: b.tick, values: { calls: b.calls, wins: b.wins } }));
  const qualified = conv.leads.rows.find((r) => r.id === "qualified")?.count ?? 0;
  const qualifiedBefore = convBefore.leads.rows.find((r) => r.id === "qualified")?.count ?? 0;
  const upset = conv.mood.total ? (conv.mood.rows.find((r) => r.id === "upset")?.count ?? 0) / conv.mood.total : null;
  const upsetBefore = convBefore.mood.total ? (convBefore.mood.rows.find((r) => r.id === "upset")?.count ?? 0) / convBefore.mood.total : null;
  const rangeLabel = RANGES.find((r) => r.id === range)?.label ?? "";
  const dates = `${new Date(bounds.from).toLocaleDateString("en-AU", { day: "numeric", month: "short" })} – ${now.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}`;

  const exportCsv = () => {
    const blob = new Blob([callsCsv(calls, app.flows, app.contacts)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `calls-${range}-${now.toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Analytics"
        subtitle="How your agents are doing, and when people pick up."
        actions={<button type="button" className="btn-secondary" onClick={exportCsv} disabled={calls.length === 0}><Download size={15} /> Export CSV</button>}
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
        <span className="font-mono text-xs text-fg-3 lg:ml-auto">{dates}</span>
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
          {calls.length === 0 ? <Empty /> : <AreaChart points={points} series={SERIES} height={240} />}
        </Panel>
        <PickupCard data={pickupBreakdown(calls)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="By agent" className="lg:col-span-2" flush>
          <AgentTable rows={byAgent(calls, app.flows, bounds.from, bounds.to)} />
        </Panel>
        <Outcomes rows={topOutcomes(calls)} />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <TierCard title="Lead quality" tiers={LEAD_TIERS} data={conv.leads} />
        <TierCard title="Engagement" tiers={ENGAGEMENT_TIERS} data={conv.engagement} />
        <TierCard title="Caller mood" tiers={MOOD_TIERS} data={conv.mood} />
      </div>

      <BestTime regions={bestTimes(calls, app.contacts, app.settings.timezone, metric)} metric={metric} onMetric={setMetric} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Directions data={directions(calls)} />
        <TransferCard data={transfers(calls)} />
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
