"use client";

import clsx from "clsx";
import { ArrowRight, ArrowUpRight, CalendarCheck, CalendarClock, Plus, Users, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { upcomingCalls } from "@/lib/campaign";
import { dayLabel, duration, humanize, relativeTime } from "@/lib/format";
import { agentStats, answered, callsPerDay, isWin, totals } from "@/lib/stats";
import { useApp } from "@/lib/store";
import { voiceById } from "@/lib/voices";
import type { AppState, Call, Flow } from "@/lib/types";
import { AreaChart, Legend, Sparkline, type Series } from "@/components/charts";
import { CallSheet, outcomeTone } from "@/components/call-sheet";
import { Avatar, Badge, Segmented } from "@/components/ui";

const SERIES: Series[] = [
  { key: "calls", label: "Calls", color: "rgb(var(--series-1))" },
  { key: "wins", label: "Booked or done", color: "rgb(var(--series-2))" },
];

export default function HomePage() {
  const app = useApp();
  const [open, setOpen] = useState<Call | null>(null);
  const now = useMemo(() => new Date(), []);
  return (
    <div className="space-y-10">
      <StatusStrip app={app} now={now} />
      <QuickActions />
      <Agents app={app} now={now} onOpen={setOpen} />
      <Insights app={app} now={now} onOpen={setOpen} />
      <CallSheet call={open} app={app} onClose={() => setOpen(null)} />
    </div>
  );
}

// ---- Top strip: the few things you check first ----

function StatusStrip({ app, now }: { app: AppState; now: Date }) {
  const live = app.calls.filter((c) => c.live).length;
  const today = callsPerDay(app.calls, 1, now)[0].calls;
  const items: { label: string; value: ReactNode }[] = [
    { label: "Your number", value: <span className="font-mono">{app.settings.phoneNumber}</span> },
    { label: "Agents live", value: app.flows.filter((f) => f.status === "live").length },
    { label: "On a call now", value: <span className={clsx(live > 0 && "text-emerald-700 dark:text-emerald-400")}>{live}</span> },
    { label: "Calls today", value: today },
    {
      label: "Status",
      value: (
        <span className="flex items-center gap-1.5 font-mono text-2xs font-medium uppercase tracking-[0.08em] text-emerald-700 dark:text-emerald-400">
          <span className="h-1.5 w-1.5 rounded-[1px] bg-emerald-500" /> All systems normal
        </span>
      ),
    },
  ];
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 lg:grid-cols-5">
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <div className="metric-label">{item.label}</div>
          <div className="mt-2 truncate text-base text-fg">{item.value}</div>
        </div>
      ))}
    </div>
  );
}

// ---- Shortcuts: a few plain things people come here to do ----

const ACTIONS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/agents?new=1", label: "Create an agent", icon: Plus },
  { href: "/contacts", label: "Add contacts", icon: Users },
  { href: "/campaigns?new=1", label: "Start a campaign", icon: CalendarClock },
  { href: "/integrations", label: "Connect your calendar", icon: CalendarCheck },
];

function QuickActions() {
  return (
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
      {ACTIONS.map(({ href, label, icon: Icon }) => (
        <Link key={href} href={href} className="flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 text-sm text-fg-2 transition-colors hover:border-line-strong hover:bg-subtle hover:text-fg">
          <Icon size={14} className="text-fg-3" />
          {label}
        </Link>
      ))}
    </div>
  );
}

// ---- Agents: each flow with its voice, live state and recent trend ----

function Agents({ app, now, onOpen }: { app: AppState; now: Date; onOpen: (c: Call) => void }) {
  const flows = [...app.flows].sort((a, b) => Number(b.status === "live") - Number(a.status === "live"));
  return (
    <section>
      <SectionHead title="Your agents" action={<Link href="/agents" className="btn-secondary h-7 px-2.5 text-xs">All agents</Link>} />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {flows.map((flow) => (
          <AgentCard key={flow.id} flow={flow} app={app} now={now} onOpen={onOpen} />
        ))}
      </div>
    </section>
  );
}

function AgentCard({ flow, app, now, onOpen }: { flow: Flow; app: AppState; now: Date; onOpen: (c: Call) => void }) {
  const stats = agentStats(flow, app.calls, now);
  const trend = callsPerDay(app.calls.filter((c) => c.flowId === flow.id), 14, now).map((p) => p.calls);
  const liveCall = app.calls.find((c) => c.live && c.flowId === flow.id);
  const voice = voiceById(flow.agent.voiceId);
  const isLive = flow.status === "live";
  return (
    <div className="card flex flex-col overflow-hidden transition-colors hover:border-line-strong">
      <Link href={`/agents/${flow.id}`} className="block p-4 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate font-medium text-fg">{flow.name}</div>
            <div className="mt-0.5 flex items-center gap-1.5 text-xs text-fg-3">
              <Avatar name={flow.agent.name} className="h-4 w-4 border-0 text-[8px]" />
              {flow.agent.name} · {voice.accent} · {flow.direction === "inbound" ? "Answers calls" : flow.direction === "outbound" ? "Makes calls" : "Both ways"}
            </div>
          </div>
          <ArrowUpRight size={15} className="shrink-0 text-fg-4" />
        </div>
        <div className="mt-4 grid grid-cols-3 gap-3">
          <Metric label="Live now" value={stats.liveNow} highlight={stats.liveNow > 0} />
          <Metric label="Today" value={stats.today} />
          <Metric label="Answered" value={stats.answerRate === null ? "—" : `${Math.round(stats.answerRate * 100)}%`} />
        </div>
        <div className="mt-3">
          <Sparkline values={trend} />
        </div>
      </Link>
      <div className="mt-auto flex h-10 items-center justify-between gap-2 border-t border-line bg-subtle/60 px-4">
        <span className={clsx("flex items-center gap-1.5 font-mono text-2xs font-medium uppercase tracking-[0.08em]", isLive ? "text-emerald-700 dark:text-emerald-400" : "text-fg-4")}>
          <span className={clsx("h-1.5 w-1.5 rounded-[1px]", isLive ? "bg-emerald-500" : "bg-fg-4")} />
          {isLive ? "Live" : "Draft"}
        </span>
        {liveCall ? (
          <button type="button" onClick={() => onOpen(liveCall)} className="flex items-center gap-1.5 text-xs text-fg-2 hover:text-fg">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
              <span className="relative h-1.5 w-1.5 rounded-full bg-emerald-500" />
            </span>
            On a call · listen
          </button>
        ) : (
          <span className="text-xs text-fg-4">{stats.lastCallAt ? `Last call ${relativeTime(stats.lastCallAt, now)}` : "No calls yet"}</span>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value, highlight }: { label: string; value: ReactNode; highlight?: boolean }) {
  return (
    <div>
      <div className="metric-label text-2xs">{label}</div>
      <div className={clsx("mt-1 font-mono text-base tabular-nums", highlight ? "text-emerald-700 dark:text-emerald-400" : "text-fg")}>{value}</div>
    </div>
  );
}

// ---- Insights ----

type Range = "7" | "14";

function Insights({ app, now, onOpen }: { app: AppState; now: Date; onOpen: (c: Call) => void }) {
  const [range, setRange] = useState<Range>("14");
  const days = Number(range);
  const points = callsPerDay(app.calls, days, now);
  const sum = totals(points);
  const since = now.getTime() - days * 86400000;
  const inRange = app.calls.filter((c) => !c.live && new Date(c.startedAt).getTime() >= since);
  const talked = inRange.filter(answered);
  const minutes = Math.round(talked.reduce((s, c) => s + c.durationSec, 0) / 60);
  const chartPoints = points.map((p) => ({
    label: p.day.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }),
    tick: p.day.toLocaleDateString(undefined, { day: "numeric", month: "short" }),
    values: { calls: p.calls, wins: p.wins },
  }));

  return (
    <section className="space-y-3">
      <SectionHead
        title="Insights"
        action={<Segmented<Range> value={range} onChange={setRange} options={[{ value: "7", label: "7 days" }, { value: "14", label: "14 days" }]} />}
      />
      <div className="card p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="metric-label">Calls handled</div>
            <div className="mt-1.5 flex items-baseline gap-2">
              <span className="text-3xl font-semibold tabular-nums tracking-[-0.03em]">{sum.calls}</span>
              <span className="text-sm text-fg-3">{sum.calls ? `${Math.round((sum.wins / sum.calls) * 100)}% booked or done` : "no calls yet"}</span>
            </div>
          </div>
          <Legend series={SERIES} totals={sum} />
        </div>
        <AreaChart points={chartPoints} series={SERIES} />
      </div>
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <Figure label="Average call" value={talked.length ? duration(Math.round(talked.reduce((s, c) => s + c.durationSec, 0) / talked.length)) : "—"} />
        <Figure label="Minutes used" value={minutes} sub="of 500 this month" />
        <Figure label="Answered" value={inRange.length ? `${Math.round((talked.length / inRange.length) * 100)}%` : "—"} sub={`${inRange.length - talked.length} not picked up`} />
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        <Outcomes calls={inRange} />
        <NextUp app={app} now={now} />
        <RecentCalls app={app} onOpen={onOpen} />
      </div>
    </section>
  );
}

function Figure({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) {
  return (
    <div className="card min-w-0 p-3 sm:p-5">
      <div className="metric-label truncate text-2xs sm:text-2xs">{label}</div>
      <div className="mt-2 truncate text-lg font-semibold tabular-nums tracking-[-0.03em] sm:mt-3 sm:text-2xl">{value}</div>
      {sub && <div className="mt-0.5 hidden text-xs text-fg-4 sm:block">{sub}</div>}
    </div>
  );
}

function Panel({ title, href, children }: { title: string; href?: string; children: ReactNode }) {
  return (
    <div className="card flex flex-col overflow-hidden">
      <div className="flex h-10 items-center justify-between border-b border-line px-4">
        <span className="metric-label">{title}</span>
        {href && (
          <Link href={href} className="flex items-center gap-1 text-xs text-fg-3 hover:text-fg">
            See all <ArrowRight size={12} />
          </Link>
        )}
      </div>
      {children}
    </div>
  );
}

function Outcomes({ calls }: { calls: Call[] }) {
  const counts = Object.entries(
    calls.reduce<Record<string, number>>((acc, c) => ({ ...acc, [c.outcome]: (acc[c.outcome] ?? 0) + 1 }), {}),
  ).sort((a, b) => b[1] - a[1]);
  return (
    <Panel title="Outcomes">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left">
            <th className="metric-label px-4 py-2 font-normal text-2xs">Outcome</th>
            <th className="metric-label px-4 py-2 text-right font-normal text-2xs">Calls</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {counts.slice(0, 6).map(([outcome, count]) => (
            <tr key={outcome}>
              <td className="px-4 py-2">
                <span className="flex items-center gap-2">
                  <span className={clsx("h-1.5 w-1.5 rounded-full", isWin(outcome) ? "bg-emerald-500" : outcome === "no_answer" ? "bg-fg-4" : "bg-amber-500")} />
                  {humanize(outcome)}
                </span>
              </td>
              <td className="px-4 py-2 text-right font-mono tabular-nums">{count}</td>
            </tr>
          ))}
          {counts.length === 0 && (
            <tr><td className="px-4 py-3 text-fg-3" colSpan={2}>No calls in this range.</td></tr>
          )}
        </tbody>
      </table>
    </Panel>
  );
}

function NextUp({ app, now }: { app: AppState; now: Date }) {
  const upcoming = app.campaigns
    .filter((c) => c.status === "running")
    .flatMap((c) => upcomingCalls(c, app.contacts, now, 30).map((p) => ({ ...p, campaign: c })))
    .sort((a, b) => a.due.getTime() - b.due.getTime())
    .slice(0, 5);
  return (
    <Panel title="Next up" href="/campaigns">
      <div className="divide-y divide-line">
        {upcoming.length === 0 && <p className="px-4 py-3 text-sm text-fg-3">Nothing scheduled in the next 30 days.</p>}
        {upcoming.map(({ contact, due, campaign }) => (
          <div key={`${campaign.id}-${contact.id}`} className="flex items-center gap-3 px-4 py-2.5">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">{contact.name}</span>
              <span className="block truncate text-xs text-fg-4">{campaign.name}</span>
            </span>
            <span className="font-mono text-2xs text-fg-3">{dayLabel(due, now)}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function RecentCalls({ app, onOpen }: { app: AppState; onOpen: (c: Call) => void }) {
  const recent = [...app.calls].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 5);
  return (
    <Panel title="Recent calls" href="/calls">
      <div className="divide-y divide-line">
        {recent.map((call) => {
          const contact = app.contacts.find((c) => c.id === call.contactId);
          return (
            <button key={call.id} type="button" onClick={() => onOpen(call)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-subtle">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{contact?.name}</span>
                <span className="block truncate text-xs text-fg-4">{call.live ? "Now" : relativeTime(call.startedAt)}</span>
              </span>
              {call.live ? <Badge tone="green" dot>Live</Badge> : <Badge tone={outcomeTone(call.outcome)}>{humanize(call.outcome)}</Badge>}
            </button>
          );
        })}
      </div>
    </Panel>
  );
}

function SectionHead({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-base font-semibold tracking-[-0.01em]">{title}</h2>
      {action}
    </div>
  );
}
