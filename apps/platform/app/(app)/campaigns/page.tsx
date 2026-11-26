"use client";

import { Megaphone, Pause, Play, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { audienceOf, callRulesFor, campaignIssues, defaultCampaign, describeTrigger } from "@outreach/core/campaign";
import { update, useApp } from "@/lib/store";
import type { Campaign } from "@outreach/core/types";
import { STATUS } from "@/components/campaign/campaign-editor";
import { Badge, EmptyState, PageHeader } from "@/components/ui";

export default function CampaignsPage() {
  const app = useApp();
  const rules = callRulesFor(app.settings);
  const router = useRouter();
  const [query, setQuery] = useState("");

  const create = () => {
    const agent = app.flows.find((f) => f.status === "live") ?? app.flows[0];
    const campaign = defaultCampaign(agent?.id ?? "");
    update((s) => ({ ...s, campaigns: [campaign, ...s.campaigns] }));
    router.push(`/campaigns/${campaign.id}`);
  };
  // Home's "Start a campaign" links here with ?new=1. Once only: effects run twice in development.
  const handled = useRef(false);
  useEffect(() => {
    if (handled.current || new URLSearchParams(window.location.search).get("new") !== "1") return;
    handled.current = true;
    create();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setStatus = (id: string, status: Campaign["status"]) => update((s) => ({ ...s, campaigns: s.campaigns.map((c) => (c.id === id ? { ...c, status } : c)) }));
  const q = query.trim().toLowerCase();
  const shown = app.campaigns.filter((c) => !q || c.name.toLowerCase().includes(q));
  const newButton = <button type="button" className="btn-primary" onClick={create}><Plus size={15} /> New campaign</button>;

  return (
    <div>
      <PageHeader title="Campaigns" subtitle="Pick an agent, who to call and when. Calls can go out once, or keep going as people qualify." actions={newButton} />
      {app.campaigns.length === 0 ? (
        <EmptyState icon={<Megaphone size={20} />} title="No campaigns yet" body="A campaign is an agent, a list of people and calling hours. Everything else is up to you." action={newButton} />
      ) : (
        <>
          <div className="relative mb-3 sm:w-72">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-4" />
            <input className="field pl-9" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search campaigns" />
          </div>
          <div className="card overflow-hidden">
            <table className="w-full table-fixed text-sm">
              <thead className="bg-subtle/60 text-left">
                <tr>
                  <th className="metric-label px-4 py-2.5 font-normal">Campaign</th>
                  <th className="metric-label hidden w-56 px-4 py-2.5 font-normal lg:table-cell">Calls</th>
                  <th className="metric-label hidden w-32 px-4 py-2.5 font-normal md:table-cell">Audience</th>
                  <th className="metric-label hidden w-32 px-4 py-2.5 font-normal sm:table-cell">Answered</th>
                  <th className="metric-label w-40 px-4 py-2.5 text-right font-normal">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {shown.map((c) => {
                  const agent = app.flows.find((f) => f.id === c.agentId);
                  const count = audienceOf(c, app.contacts, new Date(), rules).length;
                  const blocked = campaignIssues(c, { flows: app.flows, defs: app.fieldDefs, audienceCount: count, workspace: app.settings })[0];
                  return (
                    <tr key={c.id} onClick={() => router.push(`/campaigns/${c.id}`)} className="cursor-pointer transition-colors hover:bg-subtle">
                      <td className="px-4 py-3">
                        <Link href={`/campaigns/${c.id}`} onClick={(e) => e.stopPropagation()} className="block truncate font-medium">{c.name}</Link>
                        <span className="block truncate text-xs text-fg-3">{agent?.name ?? "No agent"} · {c.audience.list ?? "All contacts"}</span>
                      </td>
                      <td className="hidden truncate px-4 py-3 text-fg-2 lg:table-cell">{c.mode === "always" ? describeTrigger(c.trigger, app.fieldDefs) : "Everyone once"}</td>
                      <td className="hidden px-4 py-3 font-mono text-xs md:table-cell">{count}</td>
                      <td className="hidden px-4 py-3 font-mono text-xs sm:table-cell">{c.answered} / {c.called}</td>
                      <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <span className="inline-flex items-center gap-2">
                          <Badge tone={STATUS[c.status].tone} dot>{STATUS[c.status].label}</Badge>
                          {c.status === "running" ? (
                            <button type="button" className="btn-icon h-7 w-7" onClick={() => setStatus(c.id, "paused")} aria-label="Pause"><Pause size={14} /></button>
                          ) : (
                            <button type="button" className="btn-icon h-7 w-7" disabled={Boolean(blocked)} title={blocked} onClick={() => setStatus(c.id, "running")} aria-label="Start"><Play size={14} /></button>
                          )}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
