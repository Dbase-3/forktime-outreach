"use client";

// The Analytics page's cards. Colours: categorical slots for pickup and splits,
// a 3-step ordinal blue for tiers, one blue hue for the heatmap (all validated
// with the dataviz validator; light slots 3–5 always carry visible labels).
// Text stays in text tokens; a number is always shown next to its colour.

import clsx from "clsx";
import { ArrowDown, ArrowDownLeft, ArrowUp, ArrowUpRight, Bot, UserRound } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import {
  MIN_REGION_CALLS,
  PICKUPS,
  PICKUP_LABEL,
  WEEK,
  WINDOWS,
  windowLabel,
  type AgentRow,
  type Cell,
  type Pickup,
  type Tally,
  type TimeMetric,
  type bestTimes,
  type directions,
  type transfers,
} from "@/lib/analytics";
import { duration, humanize } from "@/lib/format";
import { Sparkline } from "../charts";
import { Segmented } from "../ui";

export function Panel({ title, action, children, className, flush }: { title: string; action?: ReactNode; children: ReactNode; className?: string; flush?: boolean }) {
  return (
    <section className={clsx("card min-w-0 overflow-hidden", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4 sm:px-5">
        <h2 className="text-sm font-medium">{title}</h2>
        {action}
      </div>
      <div className={flush ? "mt-3" : "p-4 pt-3 sm:p-5 sm:pt-3"}>{children}</div>
    </section>
  );
}

// ---- Headline figures ----

export interface Kpi {
  label: string;
  value: string;
  sub?: string;
  delta: number | null;
  kind: "count" | "rate";
  good: "up" | "down" | "neutral";
}

export function Kpis({ items, compareTo }: { items: Kpi[]; compareTo: string }) {
  return (
    <div>
      <div className="card grid grid-cols-2 overflow-hidden lg:grid-cols-4">
        {items.map((k, i) => (
          <div key={k.label} className={clsx("min-w-0 p-4", i % 2 === 1 && "border-l border-line", i >= 2 && "border-t border-line", "lg:border-l lg:border-t-0", i % 4 === 0 && "lg:border-l-0", i >= 4 && "lg:border-t")}>
            <div className="metric-label">{k.label}</div>
            <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="text-2xl font-semibold tabular-nums tracking-[-0.03em]">{k.value}</span>
              <Delta value={k.delta} kind={k.kind} good={k.good} />
            </div>
            {k.sub && <div className="mt-0.5 truncate text-xs text-fg-3">{k.sub}</div>}
          </div>
        ))}
      </div>
      <p className="mt-1.5 text-xs text-fg-3">Arrows compare with {compareTo}.</p>
    </div>
  );
}

function Delta({ value, kind, good }: { value: number | null; kind: "count" | "rate"; good: "up" | "down" | "neutral" }) {
  if (value === null) return null;
  const shown = kind === "rate" ? Math.round(value * 100) : Math.round(value * 100);
  if (shown === 0) return <span className="text-xs text-fg-3">no change</span>;
  const up = shown > 0;
  const tone = good === "neutral" ? "text-fg-3" : up === (good === "up") ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400";
  const Icon = up ? ArrowUp : ArrowDown;
  return (
    <span className={clsx("flex items-center gap-0.5 text-xs font-medium tabular-nums", tone)}>
      <Icon size={12} aria-hidden />
      <span className="sr-only">{up ? "up" : "down"}</span>
      {Math.abs(shown)}
      {kind === "rate" ? " pts" : "%"}
    </span>
  );
}

// ---- Pickup ----

const PICKUP_COLOR: Record<Pickup, string> = {
  answered: "rgb(var(--series-1))",
  voicemail: "rgb(var(--series-2))",
  no_answer: "rgb(var(--series-3))",
  busy: "rgb(var(--series-4))",
  failed: "rgb(var(--series-5))",
};

export function PickupCard({ data }: { data: { counts: Record<Pickup, number>; total: number; rate: number | null } }) {
  return (
    <Panel title="Pickup">
      {data.total === 0 ? (
        <p className="py-10 text-center text-sm text-fg-3">No calls made in this range.</p>
      ) : (
        <>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-semibold tabular-nums tracking-[-0.03em]">{Math.round((data.rate ?? 0) * 100)}%</span>
            <span className="text-sm text-fg-3">picked up, of {data.total} calls we made</span>
          </div>
          <SplitBar parts={PICKUPS.map((p) => ({ key: p, label: PICKUP_LABEL[p], value: data.counts[p], color: PICKUP_COLOR[p] }))} />
          <ul className="mt-3 divide-y divide-line">
            {PICKUPS.map((p) => (
              <li key={p} className="flex items-center gap-2.5 py-2 text-sm">
                <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: PICKUP_COLOR[p] }} aria-hidden />
                <span className="flex-1 text-fg-2">{PICKUP_LABEL[p]}</span>
                <span className="font-mono text-xs tabular-nums text-fg-3">{data.counts[p]}</span>
                <span className="w-10 text-right font-mono text-xs tabular-nums">{Math.round((data.counts[p] / data.total) * 100)}%</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}

/** A thin bar split into parts, with a 2 px gap between them; each part has its count on hover. */
function SplitBar({ parts }: { parts: { key: string; label: string; value: number; color: string }[] }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (!total) return <div className="mt-3 h-2.5 rounded-full bg-muted" />;
  return (
    <div className="mt-3 flex h-2.5 gap-0.5" role="img" aria-label={parts.map((p) => `${p.label} ${p.value}`).join(", ")}>
      {parts.filter((p) => p.value > 0).map((p) => (
        <div key={p.key} title={`${p.label}: ${p.value} (${Math.round((p.value / total) * 100)}%)`} className="h-full first:rounded-l-full last:rounded-r-full" style={{ width: `${(p.value / total) * 100}%`, background: p.color, minWidth: 3 }} />
      ))}
    </div>
  );
}

// ---- Per agent ----

export function AgentTable({ rows }: { rows: AgentRow[] }) {
  if (rows.length === 0) return <p className="px-5 pb-10 pt-6 text-center text-sm text-fg-3">No calls in this range.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[600px] table-fixed text-sm">
        <thead className="border-y border-line bg-subtle/60 text-left">
          <tr>
            <th className="metric-label px-4 py-2 font-normal sm:pl-5">Agent</th>
            <th className="metric-label w-16 px-3 py-2 text-right font-normal">Calls</th>
            <th className="metric-label w-24 px-3 py-2 text-right font-normal">Picked up</th>
            <th className="metric-label w-24 px-3 py-2 text-right font-normal">Avg call</th>
            <th className="metric-label w-24 px-3 py-2 text-right font-normal">Did its job</th>
            <th className="metric-label w-28 px-4 py-2 font-normal sm:pr-5">Trend</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map(({ flow, summary, trend }) => (
            <tr key={flow.id} className="hover:bg-subtle">
              <td className="px-4 py-2.5 sm:pl-5">
                <Link href={`/agents/${flow.id}`} className="block truncate font-medium hover:underline">{flow.name}</Link>
                <span className="block truncate text-xs text-fg-3">{flow.agent.name} · {flow.direction === "inbound" ? "Answers calls" : flow.direction === "outbound" ? "Makes calls" : "Both ways"}</span>
              </td>
              <td className="px-3 py-2.5 text-right font-mono tabular-nums">{summary.calls}</td>
              <td className="px-3 py-2.5 text-right font-mono tabular-nums">{summary.answerRate === null ? "—" : `${Math.round(summary.answerRate * 100)}%`}</td>
              <td className="px-3 py-2.5 text-right font-mono tabular-nums">{summary.avgSec === null ? "—" : duration(summary.avgSec)}</td>
              <td className="px-3 py-2.5 text-right font-mono tabular-nums">{summary.winRate === null ? "—" : `${Math.round(summary.winRate * 100)}%`}</td>
              <td className="px-4 py-2.5 sm:pr-5"><Sparkline values={trend} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Outcomes({ rows }: { rows: { outcome: string; count: number; share: number }[] }) {
  return (
    <Panel title="How calls ended">
      {rows.length === 0 ? (
        <p className="py-10 text-center text-sm text-fg-3">No answered calls in this range.</p>
      ) : (
        <ul className="space-y-2.5">
          {rows.map((r) => (
            <li key={r.outcome}>
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="truncate text-fg-2">{humanize(r.outcome)}</span>
                <span className="shrink-0 font-mono text-xs tabular-nums text-fg-3">{r.count} · {Math.round(r.share * 100)}%</span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-muted">
                <div className="h-full rounded-full" style={{ width: `${r.share * 100}%`, background: "rgb(var(--series-1))" }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

// ---- Tiers: lead quality, engagement, mood ----

const ORD = ["rgb(var(--ord-1))", "rgb(var(--ord-2))", "rgb(var(--ord-3))"];

export function TierCard({ title, tiers, data }: { title: string; tiers: readonly { id: string; label: string; hint: string }[]; data: { rows: Tally; total: number } }) {
  return (
    <Panel title={title} action={<span className="font-mono text-xs text-fg-3">{data.total} judged</span>}>
      {data.total === 0 ? (
        <p className="py-6 text-center text-sm text-fg-3">No answered calls in this range.</p>
      ) : (
        <ul className="space-y-3">
          {tiers.map((t, i) => {
            const row = data.rows.find((r) => r.id === t.id) ?? { count: 0, share: 0 };
            return (
              <li key={t.id}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium">{t.label}</span>
                  <span className="font-mono text-xs tabular-nums text-fg-2">{Math.round(row.share * 100)}% <span className="text-fg-3">· {row.count}</span></span>
                </div>
                <div className="text-xs text-fg-3">{t.hint}</div>
                <div className="mt-1.5 h-2 rounded-full bg-muted">
                  <div className="h-full rounded-full" style={{ width: `${row.share * 100}%`, background: ORD[i], minWidth: row.count ? 4 : 0 }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

// ---- Best time to call ----

type RegionTimes = ReturnType<typeof bestTimes>[number];

export function BestTime({ regions, metric, onMetric }: { regions: RegionTimes[]; metric: TimeMetric; onMetric: (m: TimeMetric) => void }) {
  const [regionId, setRegionId] = useRegion(regions);
  const current = regions.find((r) => r.region.id === regionId) ?? regions[0];
  return (
    <Panel
      title="Best time to call"
      action={<Segmented<TimeMetric> value={metric} onChange={onMetric} options={[{ value: "pickup", label: "Picks up" }, { value: "goal", label: "Does its job" }]} />}
    >
      <p className="-mt-1 mb-3 text-xs text-fg-3">Two-hour windows in the contact&apos;s own local time, ranked by how often calls {metric === "pickup" ? "were picked up" : "did their job"}. A window needs 3 calls to count.</p>
      {regions.length === 0 ? (
        <p className="py-8 text-center text-sm text-fg-3">No calls made in this range.</p>
      ) : (
        <>
          {regions.length > 1 && (
            <div className="mb-3 flex flex-wrap gap-1.5">
              {regions.map((r) => (
                <button
                  key={r.region.id}
                  type="button"
                  onClick={() => setRegionId(r.region.id)}
                  className={clsx("h-8 rounded-full border px-3 text-sm transition-colors", r.region.id === current.region.id ? "border-fg bg-fg text-background" : "border-line text-fg-2 hover:bg-subtle")}
                >
                  {r.region.label} <span className="font-mono text-xs opacity-70">{r.calls}</span>
                </button>
              ))}
            </div>
          )}
          {!current.enough ? (
            <p className="py-8 text-center text-sm text-fg-3">Not enough calls in {current.region.label} yet: a region needs at least {MIN_REGION_CALLS} calls ({current.calls} so far).</p>
          ) : (
            <div className="grid gap-5 lg:grid-cols-[1fr_240px]">
              <Heatmap cells={current.cells} />
              <div>
                <div className="metric-label mb-2">Best windows</div>
                <ol className="space-y-2">
                  {current.top.map((c, i) => (
                    <li key={`${c.day}-${c.window}`} className="flex items-center gap-3 rounded-lg border border-line px-3 py-2">
                      <span className="font-mono text-xs text-fg-3">{i + 1}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">{WEEK[c.day]} {windowLabel(WINDOWS[c.window])}</span>
                        <span className="block text-xs text-fg-3">{c.hits} of {c.calls} calls</span>
                      </span>
                      <span className="font-mono text-sm font-medium tabular-nums">{Math.round((c.rate ?? 0) * 100)}%</span>
                    </li>
                  ))}
                </ol>
                <p className="mt-2 text-xs text-fg-3">Times in {current.region.timezone.replace(/_/g, " ")}. Campaigns already call in each contact&apos;s own time zone.</p>
              </div>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}

function useRegion(regions: RegionTimes[]): [string, (id: string) => void] {
  const [id, setId] = useState(regions[0]?.region.id ?? "");
  return [regions.some((r) => r.region.id === id) ? id : regions[0]?.region.id ?? "", setId];
}

function Heatmap({ cells }: { cells: Cell[] }) {
  const rated = cells.filter((c) => c.rate !== null).map((c) => c.rate as number);
  const lo = Math.min(...rated);
  const hi = Math.max(...rated);
  const strength = (rate: number) => (hi === lo ? 70 : 12 + ((rate - lo) / (hi - lo)) * 88);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[440px] border-separate" style={{ borderSpacing: 2 }}>
        <thead>
          <tr>
            <th className="w-10" />
            {WINDOWS.map((w) => <th key={w} className="pb-1 text-center font-mono text-2xs font-normal text-fg-3">{windowLabel(w)}</th>)}
          </tr>
        </thead>
        <tbody>
          {WEEK.map((day, d) => (
            <tr key={day}>
              <th className="pr-2 text-left font-mono text-2xs font-normal text-fg-3">{day}</th>
              {WINDOWS.map((w, wi) => {
                const cell = cells[d * WINDOWS.length + wi];
                if (cell.rate === null) {
                  return <td key={w} className="h-9 rounded-md bg-subtle text-center font-mono text-2xs text-fg-4" title={`${day} ${windowLabel(w)}: ${cell.calls} calls, too few to rank`}>{cell.calls ? "·" : ""}</td>;
                }
                const s = strength(cell.rate);
                return (
                  <td
                    key={w}
                    className={clsx("h-9 rounded-md text-center font-mono text-xs tabular-nums", s > 55 ? "text-white" : "text-fg")}
                    style={{ background: `color-mix(in oklab, rgb(var(--series-1)) ${s}%, rgb(var(--surface)))` }}
                    title={`${day} ${windowLabel(w)}: ${cell.hits} of ${cell.calls} calls (${Math.round(cell.rate * 100)}%)`}
                  >
                    {Math.round(cell.rate * 100)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 flex items-center gap-2 text-2xs text-fg-3">
        <span>Lower</span>
        <span className="h-2 w-24 rounded-full" style={{ background: "linear-gradient(90deg, color-mix(in oklab, rgb(var(--series-1)) 12%, rgb(var(--surface))), rgb(var(--series-1)))" }} />
        <span>Higher · numbers are %</span>
      </div>
    </div>
  );
}

// ---- Inbound vs outbound, transfers ----

export function Directions({ data }: { data: ReturnType<typeof directions> }) {
  const total = data.inbound.calls + data.outbound.calls;
  return (
    <Panel title="Inbound vs outbound">
      <SplitBar parts={[{ key: "in", label: "Called in", value: data.inbound.calls, color: "rgb(var(--series-1))" }, { key: "out", label: "We called", value: data.outbound.calls, color: "rgb(var(--series-2))" }]} />
      <div className="mt-3 grid grid-cols-2 gap-3">
        <SideTile icon={<ArrowDownLeft size={15} />} color="rgb(var(--series-1))" label="Called in" calls={data.inbound.calls} share={total ? data.inbound.calls / total : 0} rows={[["Avg call", data.inbound.avgSec === null ? "—" : duration(data.inbound.avgSec)], ["Handled without a person", data.inbound.handledRate === null ? "—" : `${Math.round(data.inbound.handledRate * 100)}%`]]} />
        <SideTile icon={<ArrowUpRight size={15} />} color="rgb(var(--series-2))" label="We called" calls={data.outbound.calls} share={total ? data.outbound.calls / total : 0} rows={[["Avg call", data.outbound.avgSec === null ? "—" : duration(data.outbound.avgSec)], ["Picked up", data.outbound.pickupRate === null ? "—" : `${Math.round(data.outbound.pickupRate * 100)}%`]]} />
      </div>
    </Panel>
  );
}

export function TransferCard({ data }: { data: ReturnType<typeof transfers> }) {
  return (
    <Panel title="Transfers" action={<span className="font-mono text-xs text-fg-3">{data.rate === null ? "—" : `${Math.round(data.rate * 100)}% of answered calls`}</span>}>
      <SplitBar parts={[{ key: "person", label: "To a person", value: data.toPerson, color: "rgb(var(--series-1))" }, { key: "agent", label: "To another agent", value: data.toAgent, color: "rgb(var(--series-2))" }]} />
      <div className="mt-3 grid grid-cols-2 gap-3">
        <SideTile icon={<UserRound size={15} />} color="rgb(var(--series-1))" label="To a person" calls={data.toPerson} share={data.total ? data.toPerson / data.total : 0} rows={[["Share of answered", data.answered ? `${Math.round((data.toPerson / data.answered) * 100)}%` : "—"]]} />
        <SideTile icon={<Bot size={15} />} color="rgb(var(--series-2))" label="To another agent" calls={data.toAgent} share={data.total ? data.toAgent / data.total : 0} rows={[["Share of answered", data.answered ? `${Math.round((data.toAgent / data.answered) * 100)}%` : "—"]]} />
      </div>
    </Panel>
  );
}

function SideTile({ icon, color, label, calls, share, rows }: { icon: ReactNode; color: string; label: string; calls: number; share: number; rows: [string, string][] }) {
  return (
    <div className="rounded-lg bg-subtle p-3">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <span className="h-2 w-2 rounded-full" style={{ background: color }} aria-hidden /> {label}
        </span>
        <span className="text-fg-3">{icon}</span>
      </div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span className="text-2xl font-semibold tabular-nums tracking-[-0.03em]">{calls}</span>
        <span className="text-xs text-fg-3">{Math.round(share * 100)}%</span>
      </div>
      <dl className="mt-2 space-y-1 border-t border-line pt-2 text-xs">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-2">
            <dt className="text-fg-3">{k}</dt>
            <dd className="font-mono tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
