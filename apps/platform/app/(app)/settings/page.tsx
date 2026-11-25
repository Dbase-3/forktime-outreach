"use client";

import clsx from "clsx";
import { Phone, RotateCcw } from "lucide-react";
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
  const inboundFlows = app.flows.filter((f) => f.direction !== "outbound");

  return (
    <div className="max-w-3xl">
      <PageHeader title="Settings" />
      <div className="space-y-4">
        <Section title="Your phone number" body="Included with your plan. Your agents call from it, and calls to it are answered by the flow below.">
          <div className="flex items-center gap-3 rounded-2xl bg-gradient-to-br from-brand-50 to-white p-4 ring-1 ring-brand-100">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-600 text-white"><Phone size={18} /></span>
            <div>
              <div className="text-lg font-semibold tracking-tight">{settings.phoneNumber}</div>
              <div className="text-xs text-zinc-500">Active · local number</div>
            </div>
          </div>
          <Field label="Answer incoming calls with">
            <select className="field" value={settings.inboundFlowId} onChange={(e) => set({ inboundFlowId: e.target.value })}>
              {inboundFlows.length === 0 && <option value="">Make a flow for incoming calls first</option>}
              {inboundFlows.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </Field>
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
                <button key={day} type="button" onClick={() => set({ callingDays: on ? settings.callingDays.filter((x) => x !== d) : [...settings.callingDays, d].sort() })} className={clsx("h-9 w-11 rounded-xl border text-sm font-medium transition", on ? "border-brand-500 bg-brand-50 text-brand-700" : "border-zinc-200 text-zinc-500 hover:bg-zinc-50")}>
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
    <section className="card space-y-4 p-5">
      <div>
        <h2 className="font-semibold">{title}</h2>
        {body && <p className="mt-0.5 text-sm text-zinc-500">{body}</p>}
      </div>
      {children}
    </section>
  );
}
