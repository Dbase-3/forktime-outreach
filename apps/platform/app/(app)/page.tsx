"use client";

import clsx from "clsx";
import { ArrowRight, CheckCircle2, Circle } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { upcomingCalls } from "@/lib/automation";
import { dayLabel, humanize, relativeTime } from "@/lib/format";
import { useApp } from "@/lib/store";
import type { Call } from "@/lib/types";
import { CallSheet, outcomeTone } from "@/components/call-sheet";
import { Avatar, Badge, StatStrip } from "@/components/ui";

export default function HomePage() {
  const app = useApp();
  const [open, setOpen] = useState<Call | null>(null);
  const now = new Date();
  const weekAgo = now.getTime() - 7 * 86400000;
  const recent = app.calls.filter((c) => new Date(c.startedAt).getTime() > weekAgo);
  const wins = recent.filter((c) => outcomeTone(c.outcome) === "green").length;
  const minutes = Math.round(recent.reduce((sum, c) => sum + c.durationSec, 0) / 60);
  const upcoming = app.automations
    .filter((a) => a.enabled)
    .flatMap((a) => upcomingCalls(a, app.contacts, now, 30).map((p) => ({ ...p, automation: a })))
    .sort((a, b) => a.due.getTime() - b.due.getTime())
    .slice(0, 5);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-[-0.02em]">{greeting(now)}</h1>
          <p className="mt-1 text-sm text-fg-3">Here&rsquo;s what your agents have been up to.</p>
        </div>
        <span className="inline-flex h-7 items-center gap-2 rounded-full border border-line bg-surface px-3 text-xs text-fg-2">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
          </span>
          Answering on {app.settings.phoneNumber}
        </span>
      </div>

      <StatStrip
        items={[
          { label: "Calls this week", value: recent.length },
          { label: "Booked or done", value: wins, sub: recent.length ? `${Math.round((wins / recent.length) * 100)}% of calls` : undefined },
          { label: "Minutes used", value: minutes, sub: "of 500 this month" },
          { label: "Automations on", value: app.automations.filter((a) => a.enabled).length },
        ]}
      />

      <Checklist />

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <SectionTitle title="Next up" href="/automations" />
          <div className="card divide-y divide-line">
            {upcoming.length === 0 && <p className="p-4 text-sm text-fg-3">Nothing scheduled in the next 30 days.</p>}
            {upcoming.map(({ contact, due, automation }) => (
              <div key={`${automation.id}-${contact.id}`} className="flex items-center gap-3 px-4 py-3">
                <Avatar name={contact.name} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{contact.name}</span>
                  <span className="block truncate text-xs text-fg-3">{automation.name}</span>
                </span>
                <span className="text-xs font-medium text-fg-3">{dayLabel(due)}</span>
              </div>
            ))}
          </div>
        </section>
        <section>
          <SectionTitle title="Recent calls" href="/calls" />
          <div className="card divide-y divide-line">
            {app.calls.length === 0 && <p className="p-4 text-sm text-fg-3">No calls yet.</p>}
            {[...app.calls].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 5).map((call) => {
              const contact = app.contacts.find((c) => c.id === call.contactId);
              return (
                <button key={call.id} type="button" onClick={() => setOpen(call)} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-subtle">
                  <Avatar name={contact?.name ?? "?"} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{contact?.name}</span>
                    <span className="block truncate text-xs text-fg-3">{relativeTime(call.startedAt)}</span>
                  </span>
                  <Badge tone={outcomeTone(call.outcome)}>{humanize(call.outcome)}</Badge>
                </button>
              );
            })}
          </div>
        </section>
      </div>
      <CallSheet call={open} app={app} onClose={() => setOpen(null)} />
    </div>
  );
}

function greeting(now: Date): string {
  const hour = now.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function SectionTitle({ title, href }: { title: string; href: string }) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <h2 className="text-sm font-medium text-fg-2">{title}</h2>
      <Link href={href} className="flex items-center gap-1 text-xs text-fg-3 transition-colors hover:text-fg">
        See all <ArrowRight size={13} />
      </Link>
    </div>
  );
}

/** Getting started: hides itself once everything is done. */
function Checklist() {
  const app = useApp();
  const items = [
    { done: Boolean(app.settings.phoneNumber), label: "Get your phone number", href: "/settings" },
    { done: app.flows.some((f) => f.status === "live"), label: "Put a flow live", href: "/flows" },
    { done: app.integrations.some((i) => i.connected), label: "Connect your calendar or CRM", href: "/integrations" },
    { done: app.automations.some((a) => a.enabled), label: "Switch on an automation", href: "/automations" },
  ];
  const done = items.filter((i) => i.done).length;
  if (done === items.length) return null;
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between gap-4 px-4 py-3 sm:px-5">
        <h2 className="text-sm font-medium">Get set up</h2>
        <div className="flex items-center gap-2.5">
          <div className="h-1 w-24 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-fg transition-all" style={{ width: `${(done / items.length) * 100}%` }} />
          </div>
          <span className="font-mono text-2xs text-fg-3">{done}/{items.length}</span>
        </div>
      </div>
      <div className="grid border-t border-line sm:grid-cols-2 lg:grid-cols-4">
        {items.map((item, i) => (
          <Link
            key={item.label}
            href={item.href}
            className={clsx(
              "flex items-center gap-2.5 px-4 py-3 text-sm transition-colors hover:bg-subtle sm:px-5",
              i > 0 && "border-t border-line sm:border-t-0",
              i % 2 === 1 && "sm:border-l",
              i >= 2 && "sm:border-t lg:border-t-0",
              i === 2 && "lg:border-l",
              item.done && "text-fg-4 line-through",
            )}
          >
            {item.done ? <CheckCircle2 size={15} className="shrink-0 text-emerald-500" /> : <Circle size={15} className="shrink-0 text-fg-4" />}
            {item.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
