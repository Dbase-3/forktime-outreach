"use client";

import { CheckCircle2 } from "lucide-react";
import { update, useApp } from "@/lib/store";
import type { Integration } from "@/lib/types";
import { PageHeader } from "@/components/ui";

const INFO: Record<Integration["id"], { name: string; blurb: string; mark: string; tint: string; group: string }> = {
  hubspot: { name: "HubSpot", blurb: "Import contacts, log every call and update deals.", mark: "H", tint: "bg-orange-100 text-orange-600", group: "CRM" },
  gohighlevel: { name: "GoHighLevel", blurb: "Sync contacts and pipelines, book on GHL calendars.", mark: "G", tint: "bg-sky-100 text-sky-600", group: "CRM" },
  calcom: { name: "Cal.com", blurb: "Book meetings into your event types.", mark: "C", tint: "bg-zinc-900 text-white", group: "Calendar" },
  google_calendar: { name: "Google Calendar", blurb: "Check free times and book appointments.", mark: "G", tint: "bg-blue-100 text-blue-600", group: "Calendar" },
  zapier: { name: "Zapier", blurb: "Send call results to 6,000+ apps.", mark: "Z", tint: "bg-orange-100 text-orange-500", group: "Anything else" },
  webhook: { name: "Webhook", blurb: "Post every call's answers to your own URL.", mark: "{}", tint: "bg-violet-100 text-violet-600", group: "Anything else" },
};

export default function IntegrationsPage() {
  const { integrations } = useApp();
  const toggle = (id: Integration["id"]) => update((s) => ({ ...s, integrations: s.integrations.map((i) => (i.id === id ? { ...i, connected: !i.connected } : i)) }));
  const groups = [...new Set(Object.values(INFO).map((i) => i.group))];

  return (
    <div>
      <PageHeader title="Integrations" subtitle="Connect the tools you already use. Flows can then book, look up and update them during a call." />
      <div className="space-y-8">
        {groups.map((group) => (
          <section key={group}>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">{group}</h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {integrations.filter((i) => INFO[i.id].group === group).map((integration) => {
                const info = INFO[integration.id];
                return (
                  <div key={integration.id} className="card flex flex-col p-4">
                    <div className="flex items-center gap-3">
                      <span className={`flex h-10 w-10 items-center justify-center rounded-xl text-sm font-bold ${info.tint}`}>{info.mark}</span>
                      <span className="flex-1 font-semibold">{info.name}</span>
                      {integration.connected && <CheckCircle2 size={18} className="text-emerald-500" />}
                    </div>
                    <p className="mt-3 flex-1 text-sm text-zinc-500">{info.blurb}</p>
                    <button type="button" className={integration.connected ? "btn-secondary mt-4" : "btn-primary mt-4"} onClick={() => toggle(integration.id)}>
                      {integration.connected ? "Disconnect" : "Connect"}
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
