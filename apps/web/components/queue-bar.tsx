"use client";

import Link from "next/link";
import { Pause, Play } from "lucide-react";
import type { QueueSnapshot } from "@/lib/api";

function statusLine(queue: QueueSnapshot, windowText: string): string {
  if (queue.activeCallId) return "A call is on the line.";
  if (!queue.running) return queue.queued ? `Paused. ${queue.queued} waiting.` : "Nothing in the queue. Add numbers to begin.";
  if (queue.waiting === "outside_window") return `Waiting for calling hours: ${windowText}.`;
  if (queue.waiting === "retry_pending") return "Waiting to retry the numbers that did not answer.";
  return "Starting the next call…";
}

export function QueueBar({
  queue,
  windowText,
  error,
  busy,
  onToggle,
}: {
  queue: QueueSnapshot | undefined;
  windowText: string;
  error: string | null;
  busy: boolean;
  onToggle: (action: "start" | "pause") => void;
}) {
  if (!queue) return <div className="card h-[62px] animate-pulse" />;
  const canStart = queue.queued > 0;

  return (
    <div className="card flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
      {queue.running ? (
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => onToggle("pause")}>
          <Pause className="h-4 w-4" />
          Pause
        </button>
      ) : (
        <button type="button" className="btn-primary" disabled={busy || !canStart} onClick={() => onToggle("start")}>
          <Play className="h-4 w-4" />
          Start calling
        </button>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-gray-900">{statusLine(queue, windowText)}</p>
        <p className="text-xs text-gray-500">
          {queue.queued} in the queue. Numbers are called one at a time, in order.
          {queue.waiting === "outside_window" && (
            <>
              {" "}
              <Link href="/settings#calling-hours" className="underline">
                Change calling hours
              </Link>
            </>
          )}
        </p>
        {error && (
          <p role="alert" className="mt-1 text-xs text-red-700">
            {error}{" "}
            <Link href="/settings" className="underline">
              Open Settings
            </Link>
          </p>
        )}
      </div>
      {queue.mode === "dry" && (
        <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800" title="Set DIAL_MODE=live in apps/web/.env.local to place real calls">
          Dry run: no phone rings
        </span>
      )}
    </div>
  );
}
