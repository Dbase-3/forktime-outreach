"use client";

import clsx from "clsx";
import { Megaphone, Pause, Play, Plus } from "lucide-react";
import { useState } from "react";
import { newId } from "@/lib/flow-tree";
import { WEEKDAYS, hourLabel } from "@/lib/format";
import { nowIso, update, useApp } from "@/lib/store";
import type { Campaign } from "@/lib/types";
import { Badge, EmptyState, Field, PageHeader, Sheet, type Tone } from "@/components/ui";

const STATUS: Record<Campaign["status"], { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "gray" },
  running: { label: "Running", tone: "green" },
  paused: { label: "Paused", tone: "amber" },
  done: { label: "Done", tone: "brand" },
};

export default function CampaignsPage() {
  const app = useApp();
  const [creating, setCreating] = useState(false);
  const setStatus = (id: string, status: Campaign["status"]) => update((s) => ({ ...s, campaigns: s.campaigns.map((c) => (c.id === id ? { ...c, status } : c)) }));
  const newButton = (
    <button type="button" className="btn-primary" onClick={() => setCreating(true)}>
      <Plus size={16} /> New campaign
    </button>
  );

  return (
    <div>
      <PageHeader title="Campaigns" subtitle="Call a whole list once, inside your calling hours." actions={newButton} />
      {app.campaigns.length === 0 ? (
        <EmptyState icon={<Megaphone size={22} />} title="No campaigns yet" body="Pick a list and a flow, and the calls go out one after another." action={newButton} />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {app.campaigns.map((campaign) => {
            const flow = app.flows.find((f) => f.id === campaign.flowId);
            const pct = campaign.total ? Math.round((campaign.called / campaign.total) * 100) : 0;
            const status = STATUS[campaign.status];
            return (
              <div key={campaign.id} className="card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate font-semibold">{campaign.name}</h3>
                    <p className="truncate text-sm text-fg-3">{campaign.group} · {flow?.name}</p>
                  </div>
                  <Badge tone={status.tone} dot>{status.label}</Badge>
                </div>
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
                </div>
                <div className="mt-2 flex justify-between text-xs text-fg-3">
                  <span>{campaign.called} of {campaign.total} called · {campaign.answered} answered</span>
                  <span>{pct}%</span>
                </div>
                <div className="mt-4 flex items-center justify-between border-t border-line pt-3">
                  <span className="text-xs text-fg-4">
                    {campaign.days.map((d) => WEEKDAYS[d]).join(" ")} · {hourLabel(campaign.startHour)}–{hourLabel(campaign.endHour)}
                  </span>
                  {campaign.status === "running" && (
                    <button type="button" className="btn-secondary h-8 px-3 text-xs" onClick={() => setStatus(campaign.id, "paused")}><Pause size={14} /> Pause</button>
                  )}
                  {(campaign.status === "paused" || campaign.status === "draft") && (
                    <button type="button" className="btn-primary h-8 px-3 text-xs" onClick={() => setStatus(campaign.id, "running")}><Play size={14} /> {campaign.status === "draft" ? "Start" : "Resume"}</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <NewCampaignSheet open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

function NewCampaignSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const app = useApp();
  const groups = [...new Set(app.contacts.flatMap((c) => c.groups))];
  const flows = app.flows.filter((f) => f.direction !== "inbound");
  const [draft, setDraft] = useState({ name: "", flowId: flows[0]?.id ?? "", group: groups[0] ?? "", days: app.settings.callingDays, startHour: app.settings.callingStart, endHour: app.settings.callingEnd, retries: 1 });
  const size = app.contacts.filter((c) => c.groups.includes(draft.group)).length;
  const ready = draft.name.trim() && draft.flowId && draft.group && draft.days.length > 0 && draft.endHour > draft.startHour;
  const save = (status: Campaign["status"]) => {
    if (!ready) return;
    const campaign: Campaign = { id: newId("cmp"), name: draft.name.trim(), flowId: draft.flowId, group: draft.group, status, days: draft.days, startHour: draft.startHour, endHour: draft.endHour, retries: draft.retries, total: size, called: 0, answered: 0, createdAt: nowIso() };
    update((s) => ({ ...s, campaigns: [campaign, ...s.campaigns] }));
    onClose();
  };
  const toggleDay = (d: number) => setDraft({ ...draft, days: draft.days.includes(d) ? draft.days.filter((x) => x !== d) : [...draft.days, d].sort() });
  const hours = Array.from({ length: 24 }, (_, h) => h);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="New campaign"
      wide
      footer={
        <div className="flex gap-2">
          <button type="button" className="btn-secondary flex-1" disabled={!ready} onClick={() => save("draft")}>Save draft</button>
          <button type="button" className="btn-primary flex-1" disabled={!ready} onClick={() => save("running")}>Start calling {size > 0 && `${size} people`}</button>
        </div>
      }
    >
      <div className="space-y-5">
        <Field label="Name"><input className="field" autoFocus value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. Winter service offer" /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Who to call">
            <select className="field" value={draft.group} onChange={(e) => setDraft({ ...draft, group: e.target.value })}>
              {groups.map((g) => <option key={g}>{g}</option>)}
            </select>
          </Field>
          <Field label="Flow">
            <select className="field" value={draft.flowId} onChange={(e) => setDraft({ ...draft, flowId: e.target.value })}>
              {flows.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </Field>
        </div>
        <div>
          <span className="label">Days</span>
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAYS.map((day, d) => (
              <button key={day} type="button" onClick={() => toggleDay(d)} className={clsx("h-9 w-11 rounded-lg border text-sm font-medium transition", draft.days.includes(d) ? "border-accent bg-accent/10 text-accent" : "border-line text-fg-3 hover:bg-subtle")}>
                {day}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Field label="From">
            <select className="field" value={draft.startHour} onChange={(e) => setDraft({ ...draft, startHour: Number(e.target.value) })}>
              {hours.map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
            </select>
          </Field>
          <Field label="Until">
            <select className="field" value={draft.endHour} onChange={(e) => setDraft({ ...draft, endHour: Number(e.target.value) })}>
              {hours.map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
            </select>
          </Field>
          <div className="col-span-2 sm:col-span-1">
            <Field label="No answer? Try again">
              <select className="field" value={draft.retries} onChange={(e) => setDraft({ ...draft, retries: Number(e.target.value) })}>
                {[0, 1, 2, 3].map((n) => <option key={n} value={n}>{n === 0 ? "Don't retry" : `${n} more ${n === 1 ? "time" : "times"}`}</option>)}
              </select>
            </Field>
          </div>
        </div>
        <p className="rounded-lg bg-subtle p-3 text-xs leading-relaxed text-fg-3">
          Hours are each person&rsquo;s own local time. Numbers on your do-not-call list are skipped, and anyone who says &ldquo;don&rsquo;t call me&rdquo; is added to it automatically.
        </p>
      </div>
    </Sheet>
  );
}
