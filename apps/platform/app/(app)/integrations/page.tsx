"use client";

// Compact catalog: logo, name, one line, a small button. Connected tools show
// a green dot and their account; tapping any card opens its drawer.

import clsx from "clsx";
import { Search } from "lucide-react";
import { useState } from "react";
import { CATEGORIES, INTEGRATIONS, type IntegrationCategory } from "@/lib/integrations";
import { useApp } from "@/lib/store";
import { ConnectSheet, IntegrationLogo } from "@/components/integrations";
import { PageHeader } from "@/components/ui";

type Filter = "all" | "connected" | IntegrationCategory;

export default function IntegrationsPage() {
  const { integrations } = useApp();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const connected = (id: string) => integrations.find((i) => i.id === id && i.connected);
  const q = query.trim().toLowerCase();
  const inFilter = (f: Filter) => (i: (typeof INTEGRATIONS)[number]) => (f === "all" ? true : f === "connected" ? Boolean(connected(i.id)) : i.category === f);
  const shown = INTEGRATIONS.filter(inFilter(filter)).filter((i) => !q || `${i.name} ${i.blurb}`.toLowerCase().includes(q));
  const chips: { id: Filter; label: string }[] = [{ id: "all", label: "All" }, { id: "connected", label: "Connected" }, ...CATEGORIES];

  return (
    <div>
      <PageHeader title="Integrations" subtitle="Connect the tools you already use. Agents read from them during calls and write results back." />
      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0 sm:pb-0">
          {chips.map((chip) => (
            <button
              key={chip.id}
              type="button"
              onClick={() => setFilter(chip.id)}
              className={clsx("flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors", filter === chip.id ? "border-fg bg-fg text-background" : "border-line bg-surface text-fg-2 hover:border-line-strong")}
            >
              {chip.label}
              <span className={clsx("font-mono text-xs", filter === chip.id ? "text-background/70" : "text-fg-4")}>{INTEGRATIONS.filter(inFilter(chip.id)).length}</span>
            </button>
          ))}
        </div>
        <div className="relative lg:w-64">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-4" />
          <input className="field pl-9" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search integrations" />
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line-strong p-8 text-center text-sm text-fg-3">
          Nothing matches &ldquo;{query}&rdquo;. A{" "}
          <button type="button" className="text-accent hover:underline" onClick={() => { setQuery(""); setOpenId("webhook"); }}>webhook</button> or Zapier connects almost anything else.
        </p>
      ) : (
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((info) => {
            const conn = connected(info.id);
            return (
              <button
                key={info.id}
                type="button"
                onClick={() => setOpenId(info.id)}
                className={clsx("group flex items-center gap-3 rounded-xl border bg-surface p-3 text-left transition-colors hover:border-line-strong", conn ? "border-emerald-500/40" : "border-line")}
              >
                <IntegrationLogo info={info} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    {info.name}
                    {conn && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-label="Connected" />}
                  </span>
                  <span className="mt-0.5 line-clamp-2 block text-xs leading-snug text-fg-3">{conn?.account ?? info.blurb}</span>
                </span>
                <span className={clsx("shrink-0 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors", conn ? "border-emerald-500/30 text-emerald-700 dark:text-emerald-400" : "border-line text-fg-2 group-hover:border-line-strong group-hover:text-fg")}>
                  {conn ? "Connected" : "Connect"}
                </span>
              </button>
            );
          })}
        </div>
      )}
      <ConnectSheet id={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}
