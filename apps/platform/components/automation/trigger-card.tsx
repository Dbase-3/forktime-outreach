"use client";

// The "When" part of an automation: what makes it call someone.

import clsx from "clsx";
import { CalendarDays, Clock, PhoneIncoming, RefreshCw, UserPlus } from "lucide-react";
import { outcomesOf } from "@/lib/flow-tree";
import { humanize } from "@/lib/format";
import type { FieldDef, Flow, Trigger } from "@/lib/types";
import { Field } from "../ui";

const KINDS: { kind: Trigger["kind"]; label: string; icon: typeof Clock }[] = [
  { kind: "date_field", label: "A date on the contact", icon: CalendarDays },
  { kind: "field_change", label: "A field changes", icon: RefreshCw },
  { kind: "new_contact", label: "A new contact", icon: UserPlus },
  { kind: "call_outcome", label: "After another call", icon: PhoneIncoming },
  { kind: "schedule", label: "On a schedule", icon: Clock },
];

export function defaultTrigger(kind: Trigger["kind"], defs: FieldDef[], flows: Flow[]): Trigger {
  const dateField = defs.find((d) => d.type === "date")?.key ?? "";
  if (kind === "date_field") return { kind, field: dateField, offsetDays: 30, when: "after" };
  if (kind === "field_change") return { kind, field: defs[0]?.key ?? "", becomes: "" };
  if (kind === "new_contact") return { kind };
  if (kind === "schedule") return { kind, every: "week", time: "10:00" };
  const flow = flows[0];
  return { kind, flowId: flow?.id ?? "", outcome: flow ? outcomesOf(flow)[0] ?? "" : "" };
}

export function TriggerCard({ trigger, defs, flows, groups, onChange }: { trigger: Trigger; defs: FieldDef[]; flows: Flow[]; groups: string[]; onChange: (t: Trigger) => void }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {KINDS.map(({ kind, label, icon: Icon }) => (
          <button
            key={kind}
            type="button"
            onClick={() => kind !== trigger.kind && onChange(defaultTrigger(kind, defs, flows))}
            className={clsx("flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-sm transition", trigger.kind === kind ? "border-brand-500 bg-brand-50 text-brand-700" : "border-zinc-200 hover:bg-zinc-50")}
          >
            <Icon size={16} className="shrink-0" />
            <span className="leading-tight">{label}</span>
          </button>
        ))}
      </div>
      <TriggerDetails trigger={trigger} defs={defs} flows={flows} groups={groups} onChange={onChange} />
    </div>
  );
}

function TriggerDetails({ trigger, defs, flows, groups, onChange }: { trigger: Trigger; defs: FieldDef[]; flows: Flow[]; groups: string[]; onChange: (t: Trigger) => void }) {
  if (trigger.kind === "date_field") {
    const dateFields = defs.filter((d) => d.type === "date");
    return (
      <div className="grid grid-cols-[5.5rem_1fr] gap-3 sm:grid-cols-[6rem_9rem_1fr]">
        <Field label="Days">
          <input className="field" type="number" min={0} value={trigger.offsetDays} onChange={(e) => onChange({ ...trigger, offsetDays: Math.max(0, Number(e.target.value)) })} />
        </Field>
        <Field label="When">
          <select className="field" value={trigger.when} onChange={(e) => onChange({ ...trigger, when: e.target.value as "after" | "before" })}>
            <option value="after">after</option>
            <option value="before">before</option>
          </select>
        </Field>
        <div className="col-span-2 sm:col-span-1">
          <Field label="Date field">
            <select className="field" value={trigger.field} onChange={(e) => onChange({ ...trigger, field: e.target.value })}>
              {dateFields.length === 0 && <option value="">Add a date field on Contacts first</option>}
              {dateFields.map((d) => (
                <option key={d.key} value={d.key}>{d.label}</option>
              ))}
            </select>
          </Field>
        </div>
      </div>
    );
  }
  if (trigger.kind === "field_change") {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Field">
          <select className="field" value={trigger.field} onChange={(e) => onChange({ ...trigger, field: e.target.value })}>
            {defs.map((d) => (
              <option key={d.key} value={d.key}>{d.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Becomes">
          <input className="field" value={trigger.becomes} onChange={(e) => onChange({ ...trigger, becomes: e.target.value })} placeholder="e.g. Sold" />
        </Field>
      </div>
    );
  }
  if (trigger.kind === "new_contact") {
    return (
      <Field label="Added to" hint="Leads from your website, CRM or a form land here. The call goes out within a minute, inside calling hours.">
        <select className="field" value={trigger.group ?? ""} onChange={(e) => onChange({ ...trigger, group: e.target.value || undefined })}>
          <option value="">Any group</option>
          {groups.map((g) => (
            <option key={g}>{g}</option>
          ))}
        </select>
      </Field>
    );
  }
  if (trigger.kind === "schedule") {
    return (
      <div className="grid grid-cols-2 gap-3">
        <Field label="Every">
          <select className="field" value={trigger.every} onChange={(e) => onChange({ ...trigger, every: e.target.value as "day" | "week" | "month" })}>
            <option value="day">day</option>
            <option value="week">week</option>
            <option value="month">month</option>
          </select>
        </Field>
        <Field label="At">
          <input className="field" type="time" value={trigger.time} onChange={(e) => onChange({ ...trigger, time: e.target.value })} />
        </Field>
      </div>
    );
  }
  const flow = flows.find((f) => f.id === trigger.flowId);
  const outcomes = flow ? outcomesOf(flow) : [];
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Flow">
        <select className="field" value={trigger.flowId} onChange={(e) => {
          const next = flows.find((f) => f.id === e.target.value);
          onChange({ ...trigger, flowId: e.target.value, outcome: next ? outcomesOf(next)[0] ?? "" : "" });
        }}>
          {flows.map((f) => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </select>
      </Field>
      <Field label="Ends with">
        <select className="field" value={trigger.outcome} onChange={(e) => onChange({ ...trigger, outcome: e.target.value })}>
          {outcomes.map((o) => (
            <option key={o} value={o}>{humanize(o)}</option>
          ))}
        </select>
      </Field>
    </div>
  );
}
