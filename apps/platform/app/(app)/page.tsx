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
import { Avatar, Badge, Stat } from "@/components/ui";

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
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{greeting(now)}</h1>
        <p className="mt-1 text-sm text-zinc-500">Here&rsquo;s what your agents have been up to.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Calls this week" value={recent.length} />
        <Stat label="Booked or done" value={wins} sub={recent.length ? `${Math.round((wins / recent.length) * 100)}% of calls` : undefined} />
        <Stat label="Minutes used" value={minutes} sub="of 500 this month" />
        <Stat label="Automations on" value={app.automations.filter((a) => a.enabled).length} />
      </div>

      <Checklist />

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <SectionTitle title="Next up" href="/automations" />
          <div className="card divide-y divide-zinc-100">
            {upcoming.length === 0 && <p className="p-4 text-sm text-zinc-500">Nothing scheduled in the next 30 days.</p>}
            {upcoming.map(({ contact, due, automation }) => (
              <div key={`${automation.id}-${contact.id}`} className="flex items-center gap-3 p-3.5">
                <Avatar name={contact.name} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{contact.name}</span>
                  <span className="block truncate text-xs text-zinc-500">{automation.name}</span>
                </span>
                <span className="text-xs font-medium text-zinc-500">{dayLabel(due)}</span>
              </div>
            ))}
          </div>
        </section>
        <section>
          <SectionTitle title="Recent calls" href="/calls" />
          <div className="card divide-y divide-zinc-100">
            {app.calls.length === 0 && <p className="p-4 text-sm text-zinc-500">No calls yet.</p>}
            {[...app.calls].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 5).map((call) => {
              const contact = app.contacts.find((c) => c.id === call.contactId);
              return (
                <button key={call.id} type="button" onClick={() => setOpen(call)} className="flex w-full items-center gap-3 p-3.5 text-left transition hover:bg-zinc-50">
                  <Avatar name={contact?.name ?? "?"} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{contact?.name}</span>
                    <span className="block truncate text-xs text-zinc-500">{relativeTime(call.startedAt)}</span>
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
    <div className="mb-2.5 flex items-center justify-between">
      <h2 className="text-sm font-semibold">{title}</h2>
      <Link href={href} className="flex items-center gap-1 text-sm text-brand-600 hover:underline">
        See all <ArrowRight size={14} />
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
    <div className="card p-4 sm:p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Get set up</h2>
        <span className="text-xs text-zinc-500">{done} of {items.length}</span>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-zinc-100">
        <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${(done / items.length) * 100}%` }} />
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {items.map((item) => (
          <Link key={item.label} href={item.href} className={clsx("flex items-center gap-2.5 rounded-xl p-2.5 text-sm transition hover:bg-zinc-50", item.done && "text-zinc-400 line-through")}>
            {item.done ? <CheckCircle2 size={18} className="text-emerald-500" /> : <Circle size={18} className="text-zinc-300" />}
            {item.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
