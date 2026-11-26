"use client";

import clsx from "clsx";
import { Loader2, Phone, X } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError, ws } from "@/lib/api";
import { me } from "@/lib/store";
import Link from "next/link";
import type { ReactNode } from "react";
import { WEEKDAYS, hourLabel } from "@outreach/core/format";
import { update, useApp } from "@/lib/store";
import type { WorkspaceSettings } from "@outreach/core/types";
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

        <Section title="Calling hours" body="The outer limit for every campaign: a campaign can't call outside these hours, in each person's own time zone.">
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

        <Section title="Do-not-call list" body="One number per line, written any way. These numbers are left out of every campaign. Once calls are live, anyone who asks not to be called again is added here automatically.">
          <textarea
            className="field min-h-28 font-mono text-sm"
            value={settings.doNotCall.join("\n")}
            onChange={(e) => set({ doNotCall: e.target.value.split("\n") })}
            onBlur={() => set({ doNotCall: settings.doNotCall.map((n) => n.trim()).filter(Boolean) })}
            placeholder="+61 4…"
          />
        </Section>

        <Section title="Team" body="Everyone here can build agents and run campaigns. Owners and admins can invite people and change settings.">
          <Team />
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

type Members = { members: { userId: string; email: string; role: string }[]; invites: { id: string; email: string; role: string }[] };

function Team() {
  const app = useApp();
  const queries = useQueryClient();
  const canManage = app.workspace.role !== "member";
  const { data } = useQuery({ queryKey: ["members", app.workspace.id], queryFn: () => ws<Members>("/members") });
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<Members>) => {
    setBusy(true);
    setError(null);
    try {
      queries.setQueryData(["members", app.workspace.id], await fn());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That didn't work.");
    } finally {
      setBusy(false);
    }
  };
  const myId = me()?.user.id;
  return (
    <div className="space-y-3">
      <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line">
        {(data?.members ?? []).map((m) => (
          <li key={m.userId} className="flex items-center gap-3 px-3.5 py-2.5 text-sm">
            <span className="min-w-0 flex-1 truncate">{m.email}{m.userId === myId && <span className="text-fg-3"> (you)</span>}</span>
            {app.workspace.role === "owner" && m.userId !== myId ? (
              <select className="field h-8 w-auto py-0 text-sm" value={m.role} onChange={(e) => void run(() => ws<Members>(`/members/${m.userId}`, { method: "PATCH", body: { role: e.target.value } }))} aria-label={`Role for ${m.email}`}>
                <option value="owner">Owner</option>
                <option value="admin">Admin</option>
                <option value="member">Member</option>
              </select>
            ) : (
              <span className="text-xs capitalize text-fg-3">{m.role}</span>
            )}
            {canManage && m.userId !== myId && (
              <button type="button" className="btn-icon h-7 w-7 hover:text-rose-600" aria-label={`Remove ${m.email}`} onClick={() => void run(() => ws<Members>(`/members/${m.userId}`, { method: "DELETE" }))}><X size={14} /></button>
            )}
          </li>
        ))}
        {(data?.invites ?? []).map((i) => (
          <li key={i.id} className="flex items-center gap-3 px-3.5 py-2.5 text-sm">
            <span className="min-w-0 flex-1 truncate text-fg-2">{i.email} <span className="text-xs text-fg-3">· invited, joins when they sign in</span></span>
            <span className="text-xs capitalize text-fg-3">{i.role}</span>
            {canManage && <button type="button" className="btn-icon h-7 w-7 hover:text-rose-600" aria-label={`Cancel invite for ${i.email}`} onClick={() => void run(() => ws<Members>(`/invites/${i.id}`, { method: "DELETE" }))}><X size={14} /></button>}
          </li>
        ))}
        {!data && <li className="px-3.5 py-2.5"><span className="skeleton block h-4 w-40 rounded" /></li>}
      </ul>
      {canManage && (
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const out = await ws<Members>("/invites", { body: { email, role } });
              setEmail("");
              return out;
            });
          }}
        >
          <input className="field flex-1" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@business.com" aria-label="Email to invite" />
          <select className="field sm:w-32" value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role">
            <option value="member">Member</option>
            <option value="admin">Admin</option>
            {app.workspace.role === "owner" && <option value="owner">Owner</option>}
          </select>
          <button type="submit" className="btn-primary" disabled={busy || !email.includes("@")}>{busy && <Loader2 size={14} className="animate-spin" />} Invite</button>
        </form>
      )}
      {error && <p className="text-sm text-rose-700 dark:text-rose-400">{error}</p>}
    </div>
  );
}
