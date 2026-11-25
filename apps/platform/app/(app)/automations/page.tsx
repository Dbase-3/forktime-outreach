"use client";

import { CalendarClock, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { describeTrigger, upcomingCalls } from "@/lib/automation";
import { newId } from "@/lib/flow-tree";
import { dayLabel } from "@/lib/format";
import { nowIso, update, useApp } from "@/lib/store";
import type { Automation } from "@/lib/types";
import { defaultTrigger } from "@/components/automation/trigger-card";
import { EmptyState, PageHeader, Toggle } from "@/components/ui";

export default function AutomationsPage() {
  const app = useApp();
  const router = useRouter();
  const create = () => {
    const automation: Automation = {
      id: newId("a"),
      name: "New automation",
      enabled: false,
      trigger: defaultTrigger("date_field", app.fieldDefs, app.flows),
      conditions: [],
      flowId: app.flows[0]?.id ?? "",
      followUps: [],
      maxCallsPerWeek: 1,
      updatedAt: nowIso(),
    };
    update((s) => ({ ...s, automations: [automation, ...s.automations] }));
    router.push(`/automations/${automation.id}`);
  };
  const setEnabled = (id: string, enabled: boolean) => update((s) => ({ ...s, automations: s.automations.map((a) => (a.id === id ? { ...a, enabled } : a)) }));
  const newButton = (
    <button type="button" className="btn-primary" onClick={create}>
      <Plus size={16} /> New automation
    </button>
  );

  return (
    <div>
      <PageHeader title="Automations" subtitle="Calls that go out on their own: after a purchase, when a lead arrives, months later." actions={newButton} />
      {app.automations.length === 0 ? (
        <EmptyState icon={<CalendarClock size={22} />} title="No automations yet" body="Example: one month after a purchase, call to check in and offer a service." action={newButton} />
      ) : (
        <div className="space-y-3">
          {app.automations.map((automation) => {
            const flow = app.flows.find((f) => f.id === automation.flowId);
            const next = upcomingCalls(automation, app.contacts, new Date(), 365)[0];
            return (
              <div key={automation.id} className="card flex items-center gap-4 p-4 transition hover:border-zinc-300">
                <Link href={`/automations/${automation.id}`} className="flex min-w-0 flex-1 items-center gap-4">
                  <span className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600 sm:flex">
                    <CalendarClock size={18} />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{automation.name}</span>
                    <span className="block truncate text-sm text-zinc-500">
                      {describeTrigger(automation.trigger, app.fieldDefs, app.flows)} → {flow?.name ?? "no flow"}
                    </span>
                    {automation.enabled && next && <span className="mt-0.5 block text-xs text-zinc-400">Next: {next.contact.name}, {dayLabel(next.due).toLowerCase()}</span>}
                  </span>
                </Link>
                <Toggle checked={automation.enabled} onChange={(enabled) => setEnabled(automation.id, enabled)} label={`${automation.name} on`} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
