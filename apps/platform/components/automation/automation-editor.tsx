"use client";

import { ArrowLeft, CalendarClock, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { audienceSize, daysLabel, describeCondition, describeTrigger, upcomingCalls } from "@/lib/automation";
import { outcomesOf } from "@/lib/flow-tree";
import { dayLabel, hourLabel, humanize, WEEKDAYS } from "@/lib/format";
import { nowIso, update, useApp } from "@/lib/store";
import type { AppState, Automation, FollowUp } from "@/lib/types";
import { Avatar, EmptyState, Toggle } from "../ui";
import { ConditionsCard } from "./conditions-card";
import { TriggerCard } from "./trigger-card";

const FOLLOW_UP_OPTIONS = [
  { days: 0, label: "Don't call again" },
  { days: 2, label: "In 2 days" },
  { days: 7, label: "In 1 week" },
  { days: 30, label: "In 1 month" },
  { days: 90, label: "In 3 months" },
  { days: 180, label: "In 6 months" },
];

function save(id: string, fn: (a: Automation) => Automation): void {
  update((s) => ({ ...s, automations: s.automations.map((a) => (a.id === id ? { ...fn(a), updatedAt: nowIso() } : a)) }));
}

export function AutomationEditor({ id }: { id: string }) {
  const app = useApp();
  const router = useRouter();
  const automation = app.automations.find((a) => a.id === id);
  if (!automation) {
    return (
      <EmptyState icon={<CalendarClock size={22} />} title="This automation isn't here" body="It may have been deleted." action={<Link href="/automations" className="btn-primary">Back to automations</Link>} />
    );
  }

  const edit = (fn: (a: Automation) => Automation) => save(automation.id, fn);
  const groups = [...new Set(app.contacts.flatMap((c) => c.groups))];
  const remove = () => {
    update((s) => ({ ...s, automations: s.automations.filter((a) => a.id !== automation.id) }));
    router.push("/automations");
  };

  return (
    <div>
      <Link href="/automations" className="mb-3 inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-900">
        <ArrowLeft size={16} /> Automations
      </Link>
      <div className="mb-6 flex items-center gap-3">
        <input
          className="min-w-0 flex-1 rounded-lg bg-transparent px-1 py-0.5 text-2xl font-semibold tracking-tight outline-none transition hover:bg-zinc-100 focus:bg-white focus:ring-4 focus:ring-brand-500/10"
          value={automation.name}
          onChange={(e) => edit((a) => ({ ...a, name: e.target.value }))}
          aria-label="Automation name"
        />
        <span className="hidden text-sm text-zinc-500 sm:inline">{automation.enabled ? "On" : "Off"}</span>
        <Toggle checked={automation.enabled} onChange={(enabled) => edit((a) => ({ ...a, enabled }))} label="Automation on" />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-3">
          <Section n={1} title="When">
            <TriggerCard trigger={automation.trigger} defs={app.fieldDefs} flows={app.flows} groups={groups} onChange={(trigger) => edit((a) => ({ ...a, trigger }))} />
          </Section>
          <Section n={2} title="Only if" optional>
            <ConditionsCard conditions={automation.conditions} defs={app.fieldDefs} onChange={(conditions) => edit((a) => ({ ...a, conditions }))} />
          </Section>
          <Section n={3} title="Call with">
            <FlowPicker automation={automation} app={app} onChange={(flowId) => edit((a) => ({ ...a, flowId, followUps: [] }))} />
          </Section>
          <Section n={4} title="After the call">
            <FollowUps automation={automation} app={app} onChange={(followUps) => edit((a) => ({ ...a, followUps }))} />
          </Section>
          <Section n={5} title="Limits">
            <Limits automation={automation} app={app} onChange={(maxCallsPerWeek) => edit((a) => ({ ...a, maxCallsPerWeek }))} />
          </Section>
          <button type="button" className="btn-ghost text-rose-600 hover:bg-rose-50 hover:text-rose-700" onClick={remove}>
            <Trash2 size={16} /> Delete automation
          </button>
        </div>
        <div className="lg:sticky lg:top-10 lg:self-start">
          <Preview automation={automation} app={app} />
        </div>
      </div>
    </div>
  );
}

function Section({ n, title, optional, children }: { n: number; title: string; optional?: boolean; children: ReactNode }) {
  return (
    <section className="card p-4 sm:p-5">
      <h2 className="mb-4 flex items-center gap-2.5 text-sm font-semibold">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-600 text-xs text-white">{n}</span>
        {title}
        {optional && <span className="font-normal text-zinc-400">· optional</span>}
      </h2>
      {children}
    </section>
  );
}

function FlowPicker({ automation, app, onChange }: { automation: Automation; app: AppState; onChange: (flowId: string) => void }) {
  const flow = app.flows.find((f) => f.id === automation.flowId);
  return (
    <div className="space-y-2">
      <select className="field" value={automation.flowId} onChange={(e) => onChange(e.target.value)}>
        {app.flows.map((f) => (
          <option key={f.id} value={f.id}>{f.name}{f.status === "draft" ? " (draft)" : ""}</option>
        ))}
      </select>
      {flow && (
        <Link href={`/flows/${flow.id}`} className="inline-block text-sm text-brand-600 hover:underline">
          Open {flow.name}
        </Link>
      )}
      {flow?.status === "draft" && <p className="text-sm text-amber-700">This flow is a draft. Calls start once it&rsquo;s live.</p>}
    </div>
  );
}

function FollowUps({ automation, app, onChange }: { automation: Automation; app: AppState; onChange: (f: FollowUp[]) => void }) {
  const flow = app.flows.find((f) => f.id === automation.flowId);
  const outcomes = flow ? outcomesOf(flow) : [];
  if (outcomes.length === 0) return <p className="text-sm text-zinc-500">The flow has no endings yet, so there&rsquo;s nothing to follow up.</p>;
  const daysFor = (outcome: string) => automation.followUps.find((f) => f.outcome === outcome)?.thenDays ?? 0;
  const set = (outcome: string, thenDays: number) => onChange([...automation.followUps.filter((f) => f.outcome !== outcome), ...(thenDays > 0 ? [{ outcome, thenDays }] : [])]);
  return (
    <div className="space-y-2">
      <p className="mb-3 text-sm text-zinc-500">Call the same person again, depending on how the call ended.</p>
      {outcomes.map((outcome) => (
        <div key={outcome} className="flex flex-col gap-2 rounded-xl bg-zinc-50 p-3 sm:flex-row sm:items-center">
          <span className="flex-1 text-sm">
            Ends with <span className="font-medium">{humanize(outcome)}</span>
          </span>
          <select className="field py-2 sm:w-48" value={daysFor(outcome)} onChange={(e) => set(outcome, Number(e.target.value))}>
            {FOLLOW_UP_OPTIONS.map((o) => (
              <option key={o.days} value={o.days}>{o.label}</option>
            ))}
          </select>
        </div>
      ))}
    </div>
  );
}

function Limits({ automation, app, onChange }: { automation: Automation; app: AppState; onChange: (n: number) => void }) {
  const { settings } = app;
  const days = settings.callingDays.map((d) => WEEKDAYS[d]).join(", ");
  return (
    <div className="space-y-3 text-sm">
      <label className="flex items-center justify-between gap-3">
        <span>At most</span>
        <select className="field w-auto py-2" value={automation.maxCallsPerWeek} onChange={(e) => onChange(Number(e.target.value))}>
          {[1, 2, 3, 5].map((n) => (
            <option key={n} value={n}>{n} {n === 1 ? "call" : "calls"} a week per person</option>
          ))}
        </select>
      </label>
      <p className="text-zinc-500">
        Calls go out {days}, {hourLabel(settings.callingStart)} to {hourLabel(settings.callingEnd)} in each person&rsquo;s own time zone, and never to numbers on your do-not-call list.{" "}
        <Link href="/settings" className="text-brand-600 hover:underline">Change</Link>
      </p>
    </div>
  );
}

function Preview({ automation, app }: { automation: Automation; app: AppState }) {
  const flow = app.flows.find((f) => f.id === automation.flowId);
  const planned = upcomingCalls(automation, app.contacts, new Date(), 90);
  const reach = audienceSize(automation, app.contacts);
  const followUps = automation.followUps.map((f) => `${humanize(f.outcome).toLowerCase()}, call again in ${daysLabel(f.thenDays)}`);
  return (
    <div className="card overflow-hidden">
      <div className="bg-gradient-to-br from-brand-600 to-brand-700 p-5 text-white">
        <div className="text-xs font-medium uppercase tracking-wide text-brand-100">In plain words</div>
        <p className="mt-2 text-[15px] leading-relaxed first-letter:uppercase">
          {describeTrigger(automation.trigger, app.fieldDefs, app.flows)}
          {automation.conditions.length > 0 && <>, only if {automation.conditions.map((c) => describeCondition(c, app.fieldDefs)).join(" and ")}</>}
          , call with <span className="font-semibold">{flow?.name ?? "no flow"}</span>.
          {followUps.length > 0 && <> If it ends {followUps.join("; ")}.</>}
        </p>
      </div>
      <div className="p-5">
        <div className="mb-3 flex items-baseline justify-between">
          <h3 className="text-sm font-semibold">Next calls</h3>
          <span className="text-xs text-zinc-500">{reach} of {app.contacts.length} contacts match</span>
        </div>
        {automation.trigger.kind !== "date_field" ? (
          <p className="text-sm text-zinc-500">This one runs when it happens, so there&rsquo;s no fixed list ahead of time.</p>
        ) : planned.length === 0 ? (
          <p className="text-sm text-zinc-500">No one is due in the next 90 days.</p>
        ) : (
          <ul className="space-y-2.5">
            {planned.slice(0, 6).map(({ contact, due }) => (
              <li key={contact.id} className="flex items-center gap-3">
                <Avatar name={contact.name} className="h-8 w-8" />
                <span className="min-w-0 flex-1 truncate text-sm">{contact.name}</span>
                <span className="text-xs font-medium text-zinc-500">{dayLabel(due)}</span>
              </li>
            ))}
            {planned.length > 6 && <li className="text-xs text-zinc-400">and {planned.length - 6} more</li>}
          </ul>
        )}
        {!automation.enabled && <p className="mt-4 rounded-xl bg-zinc-50 p-3 text-xs text-zinc-500">It&rsquo;s off: nothing goes out until you switch it on.</p>}
      </div>
    </div>
  );
}
