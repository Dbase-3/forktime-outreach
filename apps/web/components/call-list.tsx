"use client";

import clsx from "clsx";
import { clockTime, dayAndTime } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import type { CallJson } from "@/lib/types";
import { StatusChip } from "./status-chip";

function when(call: CallJson): string {
  if (call.status === "queued") return call.notBefore ? `Try ${call.attempt} after ${clockTime(call.notBefore)}` : "";
  if (call.status === "dialing" || call.status === "live") return clockTime(call.startedAt);
  return dayAndTime(call.endedAt);
}

export function CallList({
  calls,
  selectedId,
  repFirstName,
  onSelect,
}: {
  calls: CallJson[] | undefined;
  selectedId: string | null;
  repFirstName: string;
  onSelect: (id: string) => void;
}) {
  if (!calls) return <div className="card h-64 animate-pulse" />;
  if (!calls.length) {
    return (
      <div className="card px-4 py-10 text-center text-sm text-gray-500">
        No calls yet. Paste some numbers on the left, then press Start calling.
      </div>
    );
  }

  return (
    <ul className="card divide-y divide-gray-100 overflow-hidden">
      {calls.map((call) => (
        <li key={call._id}>
          <button
            type="button"
            onClick={() => onSelect(call._id)}
            aria-current={call._id === selectedId}
            className={clsx(
              "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50 focus-visible:bg-gray-50 focus-visible:outline-none",
              call._id === selectedId && "bg-gray-50",
            )}
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-gray-900">{call.label || formatPhone(call.phone)}</span>
              <span className="block truncate text-xs text-gray-500">
                {call.label ? formatPhone(call.phone) : ""}
                {call.direction === "inbound" ? `${call.label ? " · " : ""}called us back` : ""}
                {call.simulated ? `${call.label ? " · " : ""}acted out` : ""}
              </span>
            </span>
            <span className="flex flex-col items-end gap-1">
              <StatusChip call={call} repFirstName={repFirstName} />
              <span className="text-[11px] tabular-nums text-gray-400">{when(call)}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
