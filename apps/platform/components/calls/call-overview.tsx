"use client";

// The Overview tab: summary, the call's facts, what it saved, the path it
// took through its flow, and how the caller sounded turn by turn.

import clsx from "clsx";
import { ArrowDownLeft, ArrowUpRight, CircleSlash, Flag } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { businessOf } from "@outreach/core/variables";
import { CALL_ACTIONS, END_REASONS, callerMoodLines, flowPath, moodLevel, moodStats } from "@outreach/core/call-review";
import { duration, humanize } from "@outreach/core/format";
import type { AppState, Call, Contact } from "@outreach/core/types";
import { fill } from "@outreach/core/practice";
import { metaOf, summarize } from "../flow/meta";
import { Badge, type Tone } from "../ui";

export function outcomeTone(outcome: string): Tone {
  if (outcome === "no_answer" || outcome === "in_progress") return "gray";
  if (/booked|set|promise|transferred|given/.test(outcome)) return "green";
  if (/not_now|needs|message/.test(outcome)) return "amber";
  if (/not_interested|wrong|failed/.test(outcome)) return "red";
  return "gray";
}

export function CallOverview({ call, app, contact }: { call: Call; app: AppState; contact?: Contact }) {
  const flow = app.flows.find((f) => f.id === call.flowId);
  const DirIcon = call.direction === "inbound" ? ArrowDownLeft : ArrowUpRight;
  return (
    <div className="space-y-7">
      <div className="rounded-lg border border-line bg-subtle p-3.5 text-sm leading-relaxed">{call.summary}</div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
        <Fact label="Outcome">{call.live ? <Badge tone="green" dot>Live now</Badge> : <Badge tone={outcomeTone(call.outcome)}>{humanize(call.outcome)}</Badge>}</Fact>
        <Fact label="Call">
          <span className="inline-flex items-center gap-1.5">
            <DirIcon size={14} className="text-fg-3" /> {call.direction === "inbound" ? "Called in" : "We called"}
          </span>
        </Fact>
        <Fact label="Did">
          {call.actions && call.actions.length > 0 ? (
            <span className="flex flex-wrap gap-1">
              {call.actions.map((a) => (
                <Badge key={a} tone="blue">{CALL_ACTIONS[a] ?? humanize(a)}</Badge>
              ))}
            </span>
          ) : (
            <span className="text-fg-3">Nothing extra</span>
          )}
        </Fact>
        <Fact label="Length">{call.live ? "In progress" : duration(call.durationSec)}</Fact>
        <Fact label="How it ended">{call.live ? "Still on the call" : call.endReason ? END_REASONS[call.endReason] : "—"}</Fact>
        <Fact label="Number"><span className="font-mono">{contact?.phone ?? "Unknown"}</span></Fact>
        <Fact label="When">{new Date(call.startedAt).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</Fact>
        <Fact label="Agent">{flow ? <Link href={`/agents/${flow.id}`} className="text-accent hover:underline">{flow.name}</Link> : "Deleted agent"}</Fact>
      </dl>

      {Object.keys(call.saved).length > 0 && (
        <Section title="Saved from the call">
          <dl className="divide-y divide-line rounded-lg border border-line">
            {Object.entries(call.saved).map(([key, value]) => (
              <div key={key} className="flex justify-between gap-4 px-3.5 py-2.5 text-sm">
                <dt className="text-fg-3">{humanize(key)}</dt>
                <dd className="text-right font-medium">{value}</dd>
              </div>
            ))}
          </dl>
        </Section>
      )}

      {flow && <PathSection call={call} app={app} contact={contact} />}
      <MoodSection call={call} />
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="metric-label mb-1">{label}</dt>
      <dd className="truncate text-sm">{children}</dd>
    </div>
  );
}

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h3 className="metric-label">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** The steps the call went through, worked out from what it saved. */
function PathSection({ call, app, contact }: { call: Call; app: AppState; contact?: Contact }) {
  const flow = app.flows.find((f) => f.id === call.flowId);
  if (!flow) return null;
  const values = { ...(contact?.fields ?? {}), ...call.saved, agent: flow.agent.name, business: businessOf(flow, app.settings.businessName) };
  const path = flowPath(flow.steps, values);
  const questions = Object.fromEntries(flow.steps.flatMap((s) => (s.kind === "ask" ? [[s.field, s.question]] : [])));
  return (
    <Section title="Path through the workflow" aside={<span className="text-xs text-fg-3">{path.steps.length} steps</span>}>
      <ol className="relative space-y-0.5 pl-1">
        {path.steps.map((step, i) => {
          const meta = metaOf(step);
          const Icon = meta.icon;
          const stopped = path.stoppedAt?.id === step.id;
          return (
            <li key={step.id} className="relative flex items-start gap-3 py-1.5">
              {i < path.steps.length - 1 && <span className="absolute left-[11px] top-8 h-[calc(100%-20px)] w-px bg-line" />}
              <span className={clsx("relative flex h-6 w-6 shrink-0 items-center justify-center rounded-md", meta.tint)}>
                <Icon size={13} />
              </span>
              <span className="min-w-0 pt-0.5">
                <span className="block truncate text-sm">{fill(summarize(step, app.fieldDefs, questions), values)}</span>
                {step.kind === "ask" && call.saved[step.field] && <span className="block text-xs text-fg-3">Answer: {call.saved[step.field]}</span>}
                {stopped && <span className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400"><CircleSlash size={12} /> The call ended before this was answered</span>}
              </span>
            </li>
          );
        })}
        {path.outcome && (
          <li className="flex items-center gap-3 py-1.5 text-sm text-fg-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-muted"><Flag size={13} /></span>
            Ended with <Badge tone={outcomeTone(path.outcome)}>{humanize(path.outcome)}</Badge>
          </li>
        )}
      </ol>
    </Section>
  );
}

const MOOD = {
  calm: { label: "Calm", bar: "bg-emerald-500", tone: "green" as Tone },
  uneasy: { label: "Uneasy", bar: "bg-amber-500", tone: "amber" as Tone },
  upset: { label: "Upset", bar: "bg-rose-500", tone: "red" as Tone },
};

/** How upset the caller sounded, turn by turn. A climb is an escalation; a flat line is a calm call. */
function MoodSection({ call }: { call: Call }) {
  const stats = moodStats(call.mood);
  if (!stats) return null;
  const lines = callerMoodLines(call.transcript, call.mood);
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  return (
    <Section title="Caller mood" aside={<Badge tone={MOOD[stats.level].tone} dot>{MOOD[stats.level].label}</Badge>}>
      <div className="rounded-lg border border-line p-3.5">
        <div className="mb-3 grid grid-cols-3 gap-3">
          <MoodFigure label="Peak" value={pct(stats.peak)} />
          <MoodFigure label="Average" value={pct(stats.mean)} />
          <MoodFigure label="Turns" value={String(stats.turns)} />
        </div>
        <div className="space-y-1.5">
          {lines.map((line, i) => (
            <div key={i} className="flex items-center gap-2.5">
              <span className="w-9 shrink-0 text-right font-mono text-xs tabular-nums text-fg-3">{pct(line.score)}</span>
              <span className="h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-muted">
                <span className={clsx("block h-full rounded-full", MOOD[moodLevel(line.score)].bar)} style={{ width: `${Math.max(3, Math.round(line.score * 100))}%` }} />
              </span>
              <span className="truncate text-xs text-fg-2" title={line.text}>{line.text || "(no words captured)"}</span>
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}

function MoodFigure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-fg-3">{label}</div>
      <div className="font-mono text-sm font-medium tabular-nums">{value}</div>
    </div>
  );
}
