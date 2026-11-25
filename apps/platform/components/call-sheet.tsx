"use client";

// One call: summary, what was saved, the transcript.

import clsx from "clsx";
import { duration, humanize, relativeTime } from "@/lib/format";
import type { AppState, Call } from "@/lib/types";
import { Badge, Sheet, type Tone } from "./ui";

export function outcomeTone(outcome: string): Tone {
  if (/booked|set|promise|transferred|given/.test(outcome)) return "green";
  if (/not_now|needs|message/.test(outcome)) return "amber";
  if (/not_interested|wrong|failed/.test(outcome)) return "red";
  return "gray";
}

export function CallSheet({ call, app, onClose }: { call: Call | null; app: AppState; onClose: () => void }) {
  const contact = call ? app.contacts.find((c) => c.id === call.contactId) : undefined;
  const flow = call ? app.flows.find((f) => f.id === call.flowId) : undefined;
  return (
    <Sheet open={call !== null} onClose={onClose} title={contact?.name ?? "Call"} wide>
      {call && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2 text-sm text-fg-3">
            <Badge tone={outcomeTone(call.outcome)}>{humanize(call.outcome)}</Badge>
            <span>{call.direction === "inbound" ? "Called in" : "We called"}</span>·<span>{duration(call.durationSec)}</span>·<span>{relativeTime(call.startedAt)}</span>
          </div>
          <div className="rounded-xl bg-accent/[0.06] p-4 text-base leading-relaxed text-fg sm:text-sm">{call.summary}</div>
          {Object.keys(call.saved).length > 0 && (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-4">Saved from the call</h3>
              <dl className="divide-y divide-line rounded-xl border border-line">
                {Object.entries(call.saved).map(([key, value]) => (
                  <div key={key} className="flex justify-between gap-4 px-4 py-2.5 text-sm">
                    <dt className="text-fg-3">{humanize(key)}</dt>
                    <dd className="text-right font-medium">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-4">Transcript · {flow?.name}</h3>
            <div className="space-y-2.5">
              {call.transcript.map((line, i) => (
                <div key={i} className={clsx("flex", line.who === "caller" && "justify-end")}>
                  <div className={clsx("max-w-[85%] rounded-xl px-3.5 py-2 text-sm leading-snug", line.who === "agent" ? "rounded-tl-md bg-muted" : "rounded-tr-md bg-fg text-background")}>
                    {line.text}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </Sheet>
  );
}
