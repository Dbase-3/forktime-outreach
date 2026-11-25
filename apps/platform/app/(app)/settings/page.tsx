"use client";

import clsx from "clsx";
import { Phone, RotateCcw } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { WEEKDAYS, hourLabel } from "@/lib/format";
import { resetWorkspace, update, useApp } from "@/lib/store";
import type { WorkspaceSettings } from "@/lib/types";
import { Field, PageHeader } from "@/components/ui";

const TIMEZONES = ["Australia/Sydney", "Australia/Melbourne", "Australia/Brisbane", "Australia/Perth", "Pacific/Auckland", "America/New_York", "America/Chicago", "America/Los_Angeles", "America/Toronto", "Europe/London", "Asia/Karachi", "Asia/Dubai"];

export default function SettingsPage() {
  const app = useApp();
  const { settings } = app;
  const set = (patch: Partial<WorkspaceSettings>) => update((s) => ({ ...s, settings: { ...s.settings, ...patch } }));
  const hours = Array.from({ length: 24 }, (_, h) => h);

  return (
    <div className="max-w-4xl">
      <PageHeader title="Settings" subtitle="Numbers, business details and calling rules." />
      <div>
        <Section title="Phone numbers" body="Each agent has its own number: it calls from it and answers calls to it.">
          <div className="divide-y divide-line overflow-hidden rounded-lg border border-line">
            {app.numbers.map((n) => {
              const owner = app.flows.find((f) => f.numberId === n.id);
              return (
                <div key={n.id} className="flex items-center gap-3 px-3.5 py-2.5">
                  <Phone size={14} className="shrink-0 text-fg-4" />
                  <span className="flex-1 font-mono text-sm">{n.display}</span>
                  <span className="truncate text-sm text-fg-3">{owner ? owner.name : "Not in use"}</span>
                </div>
              );
            })}
          </div>
          <Link href="/numbers" className="btn-secondary w-fit">Manage numbers</Link>
        </Section>

        <Section title="Business">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Business name" hint="Agents say it on calls as {business}.">
              <input className="field" value={settings.businessName} onChange={(e) => set({ businessName: e.target.value })} />
            </Field>
            <Field label="Time zone">
              <select className="field" value={settings.timezone} onChange={(e) => set({ timezone: e.target.value })}>
                {TIMEZONES.map((tz) => <option key={tz}>{tz}</option>)}
              </select>
            </Field>
          </div>
        </Section>

        <Section title="Calling hours" body="Outgoing calls only go out in these hours, in each person's own time zone.">
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAYS.map((day, d) => {
              const on = settings.callingDays.includes(d);
              return (
                <button key={day} type="button" onClick={() => set({ callingDays: on ? settings.callingDays.filter((x) => x !== d) : [...settings.callingDays, d].sort() })} className={clsx("h-9 w-11 rounded-lg border text-sm font-medium transition", on ? "border-accent bg-accent/10 text-accent" : "border-line text-fg-3 hover:bg-subtle")}>
                  {day}
                </button>
              );
            })}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="From">
              <select className="field" value={settings.callingStart} onChange={(e) => set({ callingStart: Number(e.target.value) })}>
                {hours.map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
              </select>
            </Field>
            <Field label="Until">
              <select className="field" value={settings.callingEnd} onChange={(e) => set({ callingEnd: Number(e.target.value) })}>
                {hours.map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
              </select>
            </Field>
          </div>
        </Section>

        <Section title="Do-not-call list" body="One number per line. Anyone who asks not to be called is added here automatically.">
          <textarea
            className="field min-h-28 font-mono text-sm"
            value={settings.doNotCall.join("\n")}
            onChange={(e) => set({ doNotCall: e.target.value.split("\n") })}
            onBlur={() => set({ doNotCall: settings.doNotCall.map((n) => n.trim()).filter(Boolean) })}
            placeholder="+61 4…"
          />
        </Section>

        <Section title="Sample data" body="This preview keeps everything in your browser. Start over with the sample workspace any time.">
          <button type="button" className="btn-secondary" onClick={resetWorkspace}>
            <RotateCcw size={16} /> Reset to sample workspace
          </button>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, body, children }: { title: string; body?: string; children: ReactNode }) {
  return (
    <section className="grid gap-4 border-b border-line py-7 first:pt-0 last:border-0 md:grid-cols-[260px_minmax(0,1fr)] md:gap-10">
      <div>
        <h2 className="text-base font-medium">{title}</h2>
        {body && <p className="mt-1 text-sm text-fg-3">{body}</p>}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}
