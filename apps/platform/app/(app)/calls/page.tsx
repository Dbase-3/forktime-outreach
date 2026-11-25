"use client";

import { ArrowDownLeft, ArrowUpRight, PhoneCall } from "lucide-react";
import { useState } from "react";
import { duration, humanize, relativeTime } from "@/lib/format";
import { useApp } from "@/lib/store";
import type { Call } from "@/lib/types";
import { CallSheet, outcomeTone } from "@/components/call-sheet";
import { Avatar, Badge, EmptyState, PageHeader, Segmented } from "@/components/ui";

type Filter = "all" | "inbound" | "outbound";

export default function CallsPage() {
  const app = useApp();
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<Call | null>(null);
  const calls = [...app.calls]
    .filter((c) => filter === "all" || c.direction === filter)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));

  return (
    <div>
      <PageHeader title="Calls" subtitle="Every call, with a summary, what was saved and the full transcript." />
      <div className="mb-4">
        <Segmented<Filter>
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All" },
            { value: "outbound", label: "We called" },
            { value: "inbound", label: "Called in" },
          ]}
        />
      </div>
      {calls.length === 0 ? (
        <EmptyState icon={<PhoneCall size={22} />} title="No calls yet" body="Calls show up here as they happen." />
      ) : (
        <div className="card divide-y divide-line overflow-hidden">
          {calls.map((call) => {
            const contact = app.contacts.find((c) => c.id === call.contactId);
            const flow = app.flows.find((f) => f.id === call.flowId);
            const DirIcon = call.direction === "inbound" ? ArrowDownLeft : ArrowUpRight;
            return (
              <button key={call.id} type="button" onClick={() => setOpen(call)} className="flex w-full items-center gap-3 p-4 text-left transition hover:bg-subtle">
                <Avatar name={contact?.name ?? "?"} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 font-medium">
                    <span className="truncate">{contact?.name ?? "Unknown caller"}</span>
                    <DirIcon size={14} className="shrink-0 text-fg-4" />
                  </span>
                  <span className="block truncate text-sm text-fg-3">{call.summary}</span>
                  <span className="mt-0.5 block text-xs text-fg-4">{flow?.name} · {duration(call.durationSec)}</span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1.5">
                  <Badge tone={outcomeTone(call.outcome)}>{humanize(call.outcome)}</Badge>
                  <span className="text-xs text-fg-4">{relativeTime(call.startedAt)}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
      <CallSheet call={open} app={app} onClose={() => setOpen(null)} />
    </div>
  );
}
