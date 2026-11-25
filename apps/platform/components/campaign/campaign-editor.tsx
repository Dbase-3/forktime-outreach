"use client";

// One campaign. The basics are always there (agent, who, when); conditions,
// triggers, follow-ups and what happens after the call are added as needed.

import clsx from "clsx";
import { ArrowLeft, ArrowRight, Pause, Play, Plus, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { dataSchema } from "@/lib/agent-data";
import { daysLabel } from "@/lib/automation";
import { audienceOf, campaignIssues, campaignSummary, upcomingCalls } from "@/lib/campaign";
import { allColumns } from "@/lib/contacts-table";
import { newId, outcomesOf } from "@/lib/flow-tree";
import { WEEKDAYS, dayLabel, hourLabel, humanize } from "@/lib/format";
import { integrationInfo } from "@/lib/integrations";
import { update, useApp } from "@/lib/store";
import type { AppState, Campaign, FollowUp, Trigger } from "@/lib/types";
import { IntegrationLogo } from "../integrations";
import { RulesEditor } from "../rules-editor";
import { Avatar, Badge, EmptyState, Segmented, Toggle } from "../ui";

function save(id: string, fn: (c: Campaign) => Campaign): void {
  update((s) => ({ ...s, campaigns: s.campaigns.map((c) => (c.id === id ? fn(c) : c)) }));
}

export const STATUS: Record<Campaign["status"], { label: string; tone: "gray" | "green" | "amber" | "brand" }> = {
  draft: { label: "Draft", tone: "gray" },
  running: { label: "Running", tone: "green" },
  paused: { label: "Paused", tone: "amber" },
  done: { label: "Done", tone: "brand" },
};

export function CampaignEditor({ id }: { id: string }) {
  const app = useApp();
  const router = useRouter();
  const c = app.campaigns.find((x) => x.id === id);
  if (!c) return <EmptyState icon={<Play size={20} />} title="This campaign isn't here" body="It may have been deleted." action={<Link href="/campaigns" className="btn-primary">Back to campaigns</Link>} />;

  const edit = (fn: (c: Campaign) => Campaign) => save(c.id, fn);
  const issues = campaignIssues(c, app.flows);
  const audience = audienceOf(c, app.contacts);
  const remove = () => {
    update((s) => ({ ...s, campaigns: s.campaigns.filter((x) => x.id !== c.id) }));
    router.push("/campaigns");
  };

  return (
    <div>
      <Link href="/campaigns" className="mb-3 inline-flex items-center gap-1.5 text-sm text-fg-3 hover:text-fg"><ArrowLeft size={15} /> Campaigns</Link>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <input className="-ml-1 min-w-0 flex-1 rounded-lg bg-transparent px-1 py-0.5 text-xl font-semibold tracking-[-0.02em] outline-none transition-colors hover:bg-subtle focus:bg-surface focus:ring-[3px] focus:ring-fg/5" value={c.name} onChange={(e) => edit((x) => ({ ...x, name: e.target.value }))} aria-label="Campaign name" />
        <Badge tone={STATUS[c.status].tone} dot>{STATUS[c.status].label}</Badge>
        {c.status === "running" ? (
          <button type="button" className="btn-secondary" onClick={() => edit((x) => ({ ...x, status: "paused" }))}><Pause size={15} /> Pause</button>
        ) : (
          <button type="button" className="btn-primary" disabled={issues.length > 0} title={issues[0]} onClick={() => edit((x) => ({ ...x, status: "running" }))}><Play size={15} /> {c.status === "paused" ? "Resume" : "Start"}</button>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-3">
          <AgentSection c={c} app={app} edit={edit} />
          <AudienceSection c={c} app={app} edit={edit} count={audience.length} />
          <WhenSection c={c} app={app} edit={edit} />
          <FollowUpSection c={c} app={app} edit={edit} />
          <AfterCallSection c={c} app={app} edit={edit} />
          <button type="button" className="btn-ghost text-rose-600 hover:bg-rose-500/10" onClick={remove}><Trash2 size={15} /> Delete campaign</button>
        </div>
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <Summary c={c} app={app} count={audience.length} issues={issues} />
        </aside>
      </div>
    </div>
  );
}

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="card p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 py-2 sm:flex-row sm:items-center sm:gap-4">
      <span className="w-40 shrink-0 text-sm text-fg-2">{label}</span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm text-fg-3 transition-colors hover:bg-muted hover:text-fg">
      <Plus size={14} /> {label}
    </button>
  );
}

type Edit = (fn: (c: Campaign) => Campaign) => void;

function AgentSection({ c, app, edit }: { c: Campaign; app: AppState; edit: Edit }) {
  const agent = app.flows.find((f) => f.id === c.agentId);
  return (
    <Section title="Agent" aside={agent && <Link href={`/agents/${agent.id}`} className="flex items-center gap-1 text-xs text-fg-3 hover:text-fg">Open agent <ArrowRight size={12} /></Link>}>
      <div className="flex flex-wrap items-center gap-3">
        <select className="field sm:w-72" value={c.agentId} onChange={(e) => edit((x) => ({ ...x, agentId: e.target.value }))} aria-label="Agent">
          {app.flows.map((f) => <option key={f.id} value={f.id}>{f.name}{f.status === "draft" ? " (draft)" : ""}</option>)}
        </select>
        {agent && (
          <span className="flex items-center gap-2 text-sm text-fg-3">
            <Avatar name={agent.agent.name} className="h-6 w-6 text-2xs" /> {agent.agent.name} · collects {dataSchema(agent).length} fields
          </span>
        )}
      </div>
    </Section>
  );
}

function AudienceSection({ c, app, edit, count }: { c: Campaign; app: AppState; edit: Edit; count: number }) {
  const lists = [...new Set(app.contacts.flatMap((x) => x.groups))].sort();
  const fields = allColumns(app.fieldDefs).filter((f) => !["lists", "last_call", "last_outcome", "created"].includes(f.key));
  return (
    <Section title="Who to call" aside={<span className="font-mono text-xs text-fg-3">{count} {count === 1 ? "person" : "people"}</span>}>
      <Row label="From">
        <select className="field sm:w-72" value={c.audience.list ?? ""} onChange={(e) => edit((x) => ({ ...x, audience: { ...x.audience, list: e.target.value || null } }))} aria-label="List">
          <option value="">All contacts</option>
          {lists.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
      </Row>
      <div className="mt-1 border-t border-line pt-3">
        <RulesEditor group={c.audience.filter} fields={fields} onChange={(filter) => edit((x) => ({ ...x, audience: { ...x.audience, filter } }))} addLabel="Add a condition" />
      </div>
    </Section>
  );
}

const TRIGGERS: { kind: Trigger["kind"]; label: string }[] = [
  { kind: "added", label: "When they join" },
  { kind: "date_field", label: "Around a date" },
  { kind: "field_change", label: "When a field changes" },
  { kind: "schedule", label: "On a schedule" },
];

function WhenSection({ c, app, edit }: { c: Campaign; app: AppState; edit: Edit }) {
  const dateFields = app.fieldDefs.filter((d) => d.type === "date");
  const hours = Array.from({ length: 24 }, (_, h) => h);
  const setTrigger = (kind: Trigger["kind"]) => {
    const t: Trigger = kind === "date_field" ? { kind, field: dateFields[0]?.key ?? "", offsetDays: 30, when: "after" } : kind === "field_change" ? { kind, field: app.fieldDefs[0]?.key ?? "", becomes: "" } : kind === "schedule" ? { kind, every: "week", time: "10:00" } : { kind: "added" };
    edit((x) => ({ ...x, trigger: t }));
  };
  const t = c.trigger;
  return (
    <Section title="When to call">
      <Segmented<Campaign["mode"]> value={c.mode} onChange={(mode) => edit((x) => ({ ...x, mode }))} options={[{ value: "once", label: "Call everyone once" }, { value: "always", label: "Keep calling as people qualify" }]} />

      <div className="mt-3 divide-y divide-line">
        {c.mode === "once" ? (
          <Row label="Start">
            <Segmented<"now" | "at"> value={c.startAt ? "at" : "now"} onChange={(v) => edit((x) => ({ ...x, startAt: v === "now" ? null : new Date(Date.now() + 86400000).toISOString().slice(0, 16) }))} options={[{ value: "now", label: "When I start it" }, { value: "at", label: "At a set time" }]} />
            {c.startAt && <input type="datetime-local" className="field w-auto" value={c.startAt.slice(0, 16)} onChange={(e) => edit((x) => ({ ...x, startAt: e.target.value }))} aria-label="Start at" />}
          </Row>
        ) : (
          <div className="py-2">
            <div className="mb-2 flex flex-wrap gap-1.5">
              {TRIGGERS.map((opt) => (
                <button key={opt.kind} type="button" onClick={() => opt.kind !== t.kind && setTrigger(opt.kind)} className={clsx("h-8 rounded-full border px-3 text-sm transition-colors", t.kind === opt.kind ? "border-fg bg-fg text-background" : "border-line text-fg-2 hover:border-line-strong")}>{opt.label}</button>
              ))}
            </div>
            {t.kind === "added" && <p className="text-sm text-fg-3">Calls each new contact in the audience within minutes, inside calling hours: new CRM records, imports or contacts added by hand.</p>}
            {t.kind === "date_field" && (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                {t.when !== "on" && <input type="number" min={0} className="field h-9 w-20" value={t.offsetDays} onChange={(e) => edit((x) => ({ ...x, trigger: { ...t, offsetDays: Math.max(0, Number(e.target.value)) } }))} aria-label="Days" />}
                {t.when !== "on" && <span className="text-fg-3">days</span>}
                <select className="field h-9 w-auto" value={t.when} onChange={(e) => edit((x) => ({ ...x, trigger: { ...t, when: e.target.value as "after" | "before" | "on" } }))} aria-label="Before or after">
                  <option value="after">after</option>
                  <option value="before">before</option>
                  <option value="on">on</option>
                </select>
                <span className="text-fg-3">their</span>
                <select className="field h-9 w-auto" value={t.field} onChange={(e) => edit((x) => ({ ...x, trigger: { ...t, field: e.target.value } }))} aria-label="Date field">
                  {dateFields.length === 0 && <option value="">Add a date field in Contacts first</option>}
                  {dateFields.map((d) => <option key={d.key} value={d.key}>{d.label.toLowerCase()}</option>)}
                </select>
              </div>
            )}
            {t.kind === "field_change" && (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-fg-3">When</span>
                <select className="field h-9 w-auto" value={t.field} onChange={(e) => edit((x) => ({ ...x, trigger: { ...t, field: e.target.value } }))} aria-label="Field">
                  {app.fieldDefs.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
                </select>
                <span className="text-fg-3">becomes</span>
                <input className="field h-9 w-40" value={t.becomes} onChange={(e) => edit((x) => ({ ...x, trigger: { ...t, becomes: e.target.value } }))} placeholder="e.g. Sold" aria-label="Becomes" />
              </div>
            )}
            {t.kind === "schedule" && (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-fg-3">Every</span>
                <select className="field h-9 w-auto" value={t.every} onChange={(e) => edit((x) => ({ ...x, trigger: { ...t, every: e.target.value as "day" | "week" | "month" } }))} aria-label="Every">
                  <option value="day">day</option>
                  <option value="week">week</option>
                  <option value="month">month</option>
                </select>
                <span className="text-fg-3">at</span>
                <input type="time" className="field h-9 w-auto" value={t.time} onChange={(e) => edit((x) => ({ ...x, trigger: { ...t, time: e.target.value } }))} aria-label="Time" />
              </div>
            )}
          </div>
        )}

        <Row label="Days">
          {WEEKDAYS.map((day, d) => {
            const on = c.days.includes(d);
            return <button key={day} type="button" aria-pressed={on} onClick={() => edit((x) => ({ ...x, days: on ? x.days.filter((y) => y !== d) : [...x.days, d].sort() }))} className={clsx("h-8 w-11 rounded-lg border text-sm transition-colors", on ? "border-fg bg-fg text-background" : "border-line text-fg-3 hover:border-line-strong")}>{day}</button>;
          })}
        </Row>
        <Row label="Hours">
          <select className="field h-9 w-auto" value={c.startHour} onChange={(e) => edit((x) => ({ ...x, startHour: Number(e.target.value) }))} aria-label="From">{hours.map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}</select>
          <span className="text-sm text-fg-3">to</span>
          <select className="field h-9 w-auto" value={c.endHour} onChange={(e) => edit((x) => ({ ...x, endHour: Number(e.target.value) }))} aria-label="Until">{hours.map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}</select>
          <label className="ml-1 flex items-center gap-2 text-sm text-fg-2"><Toggle checked={c.contactTimezone} onChange={(v) => edit((x) => ({ ...x, contactTimezone: v }))} label="In each person's time zone" /> their time zone</label>
        </Row>
        <Row label="No answer">
          <select className="field h-9 w-auto" value={c.attempts} onChange={(e) => edit((x) => ({ ...x, attempts: Number(e.target.value) }))} aria-label="Tries">{[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n === 1 ? "Don't try again" : `Try ${n - 1} more ${n === 2 ? "time" : "times"}`}</option>)}</select>
          {c.attempts > 1 && <select className="field h-9 w-auto" value={c.retryHours} onChange={(e) => edit((x) => ({ ...x, retryHours: Number(e.target.value) }))} aria-label="Gap">{[1, 2, 4, 24].map((h) => <option key={h} value={h}>{h === 24 ? "next day" : `${h} h later`}</option>)}</select>}
        </Row>
        <Row label="Voicemail">
          <Segmented<Campaign["voicemail"]> value={c.voicemail} onChange={(voicemail) => edit((x) => ({ ...x, voicemail }))} options={[{ value: "hang_up", label: "Hang up" }, { value: "leave_message", label: "Leave a message" }]} />
          {c.voicemail === "leave_message" && <textarea className="field mt-1 min-h-16 w-full" value={c.voicemailText} onChange={(e) => edit((x) => ({ ...x, voicemailText: e.target.value }))} placeholder="Hi {first_name}, it's {agent} from {business}, the AI assistant. Sorry we missed you…" />}
        </Row>
        <Row label="Pace and limits">
          <select className="field h-9 w-auto" value={c.concurrent} onChange={(e) => edit((x) => ({ ...x, concurrent: Number(e.target.value) }))} aria-label="Calls at once">{[1, 2, 3, 5, 10].map((n) => <option key={n} value={n}>{n} {n === 1 ? "call" : "calls"} at once</option>)}</select>
          <select className="field h-9 w-auto" value={c.maxPerWeek} onChange={(e) => edit((x) => ({ ...x, maxPerWeek: Number(e.target.value) }))} aria-label="Per person">{[1, 2, 3].map((n) => <option key={n} value={n}>at most {n} a week per person</option>)}</select>
        </Row>
      </div>
    </Section>
  );
}

const AFTER_DAYS = [0, 1, 2, 7, 14, 30, 90, 180];

function FollowUpSection({ c, app, edit }: { c: Campaign; app: AppState; edit: Edit }) {
  const agent = app.flows.find((f) => f.id === c.agentId);
  const outcomes = agent ? outcomesOf(agent) : [];
  const set = (id: string, patch: Partial<FollowUp>) => edit((x) => ({ ...x, followUps: x.followUps.map((f) => (f.id === id ? { ...f, ...patch } : f)) }));
  const add = () => edit((x) => ({ ...x, followUps: [...x.followUps, { id: newId("fu"), outcome: outcomes[0] ?? "", action: "call", afterDays: 7 }] }));
  return (
    <Section title="Follow-ups">
      <div className="space-y-2">
        {c.followUps.map((f) => (
          <div key={f.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-subtle p-2.5 text-sm">
            <span className="text-fg-3">If it ends</span>
            <select className="field h-8 w-auto py-0" value={f.outcome} onChange={(e) => set(f.id, { outcome: e.target.value })} aria-label="Outcome">{outcomes.map((o) => <option key={o} value={o}>{humanize(o)}</option>)}</select>
            <select className="field h-8 w-auto py-0" value={f.action} onChange={(e) => set(f.id, { action: e.target.value as FollowUp["action"] })} aria-label="Then">
              <option value="call">call again</option>
              <option value="text">send a text</option>
            </select>
            <select className="field h-8 w-auto py-0" value={f.afterDays} onChange={(e) => set(f.id, { afterDays: Number(e.target.value) })} aria-label="When">{AFTER_DAYS.map((d) => <option key={d} value={d}>{d === 0 ? "straight away" : `after ${daysLabel(d)}`}</option>)}</select>
            {f.action === "call" && (
              <select className="field h-8 w-auto py-0" value={f.agentId ?? c.agentId} onChange={(e) => set(f.id, { agentId: e.target.value })} aria-label="With agent">{app.flows.map((a) => <option key={a.id} value={a.id}>with {a.name}</option>)}</select>
            )}
            {f.action === "text" && <input className="field h-8 min-w-48 flex-1 py-0" value={f.text ?? ""} onChange={(e) => set(f.id, { text: e.target.value })} placeholder="The text, e.g. Here's the booking link…" aria-label="Text" />}
            <button type="button" className="btn-icon ml-auto h-8 w-8" onClick={() => edit((x) => ({ ...x, followUps: x.followUps.filter((y) => y.id !== f.id) }))} aria-label="Remove follow-up"><X size={14} /></button>
          </div>
        ))}
        {c.followUps.length === 0 && <p className="text-sm text-fg-3">Call again later or send a text, depending on how a call ends.</p>}
        <AddButton label="Add a follow-up" onClick={add} />
      </div>
    </Section>
  );
}

function AfterCallSection({ c, app, edit }: { c: Campaign; app: AppState; edit: Edit }) {
  const agent = app.flows.find((f) => f.id === c.agentId);
  const schema = agent ? dataSchema(agent) : [];
  const connected = app.integrations.filter((i) => i.connected && ["crm", "messaging", "data"].includes(integrationInfo(i.id)?.category ?? ""));
  const addWriteBack = () => {
    const first = schema.find((s) => !c.writeBacks.some((w) => w.from === s.key));
    if (!first) return;
    edit((x) => ({ ...x, writeBacks: [...x.writeBacks, { from: first.key, to: first.key }] }));
  };
  const setTo = (from: string, to: string) => {
    if (!app.fieldDefs.some((d) => d.key === to)) {
      const field = schema.find((s) => s.key === to);
      update((s) => ({ ...s, fieldDefs: [...s.fieldDefs, { key: to, label: field?.label ?? to, type: field?.type ?? "text", source: "call" }] }));
    }
    edit((x) => ({ ...x, writeBacks: x.writeBacks.map((w) => (w.from === from ? { ...w, to } : w)) }));
  };
  return (
    <Section title="After the call">
      <div className="space-y-4">
        <div>
          <div className="mb-1.5 text-sm text-fg-2">Save answers to the contact</div>
          <div className="space-y-2">
            {c.writeBacks.map((w) => (
              <div key={w.from} className="flex flex-wrap items-center gap-2 text-sm">
                <select className="field h-8 w-auto py-0 font-mono text-xs" value={w.from} onChange={(e) => edit((x) => ({ ...x, writeBacks: x.writeBacks.map((y) => (y.from === w.from ? { ...y, from: e.target.value } : y)) }))} aria-label="Answer">
                  {schema.map((s) => <option key={s.key} value={s.key}>{s.key}</option>)}
                </select>
                <ArrowRight size={14} className="text-fg-4" />
                <select className="field h-8 w-auto py-0" value={w.to} onChange={(e) => setTo(w.from, e.target.value)} aria-label="Contact field">
                  {!app.fieldDefs.some((d) => d.key === w.from) && <option value={w.from}>New field: {w.from.replace(/_/g, " ")}</option>}
                  {app.fieldDefs.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
                </select>
                <button type="button" className="btn-icon h-8 w-8" onClick={() => edit((x) => ({ ...x, writeBacks: x.writeBacks.filter((y) => y.from !== w.from) }))} aria-label="Remove"><X size={14} /></button>
              </div>
            ))}
            {schema.length > c.writeBacks.length && <AddButton label="Save an answer" onClick={addWriteBack} />}
          </div>
        </div>
        {connected.length > 0 && (
          <div className="divide-y divide-line rounded-lg border border-line">
            {connected.map((i) => {
              const info = integrationInfo(i.id);
              if (!info) return null;
              const on = c.logTo.includes(i.id);
              const verb = info.category === "crm" ? `Log each call in ${info.name}` : info.category === "messaging" ? `Post each call to ${info.name}` : `Send each call to ${info.name}`;
              return (
                <label key={i.id} className="flex items-center gap-3 px-3 py-2.5">
                  <IntegrationLogo info={info} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm">{verb}</span>
                    <span className="block truncate text-xs text-fg-3">{i.account}</span>
                  </span>
                  <Toggle checked={on} onChange={(v) => edit((x) => ({ ...x, logTo: v ? [...x.logTo, i.id] : x.logTo.filter((y) => y !== i.id) }))} label={verb} />
                </label>
              );
            })}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-fg-2">Webhook</span>
          <input className="field h-9 min-w-0 flex-1 font-mono text-sm" value={c.webhook} onChange={(e) => edit((x) => ({ ...x, webhook: e.target.value }))} placeholder="https://… gets the call's record as JSON" aria-label="Webhook" />
        </div>
      </div>
    </Section>
  );
}

function Summary({ c, app, count, issues }: { c: Campaign; app: AppState; count: number; issues: string[] }) {
  const lines = campaignSummary(c, app.flows, app.fieldDefs, count);
  const next = upcomingCalls(c, app.contacts, new Date(), 60).slice(0, 5);
  return (
    <div className="card overflow-hidden">
      <div className="border-b border-line bg-subtle p-4">
        <div className="eyebrow mb-2">In plain words</div>
        <div className="space-y-1.5 text-sm leading-relaxed text-fg-2">{lines.map((l, i) => <p key={i}>{l}</p>)}</div>
      </div>
      {issues.length > 0 && (
        <ul className="space-y-1 border-b border-line px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
          {issues.map((i) => <li key={i}>• {i}</li>)}
        </ul>
      )}
      <dl className="grid grid-cols-3 divide-x divide-line border-b border-line text-center">
        {[{ label: "Audience", value: count }, { label: "Called", value: c.called }, { label: "Answered", value: c.answered }].map((m) => (
          <div key={m.label} className="py-3">
            <dt className="metric-label text-2xs">{m.label}</dt>
            <dd className="mt-1 font-mono text-base tabular-nums">{m.value}</dd>
          </div>
        ))}
      </dl>
      {c.mode === "always" && c.trigger.kind === "date_field" && (
        <div className="p-4">
          <div className="mb-2 text-sm font-medium">Next calls</div>
          {next.length === 0 ? <p className="text-sm text-fg-3">No one due in the next 60 days.</p> : (
            <ul className="space-y-2">
              {next.map(({ contact, due }) => (
                <li key={contact.id} className="flex items-center gap-2.5 text-sm">
                  <Avatar name={contact.name} className="h-7 w-7" />
                  <span className="min-w-0 flex-1 truncate">{contact.name}</span>
                  <span className="font-mono text-2xs text-fg-3">{dayLabel(due)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
