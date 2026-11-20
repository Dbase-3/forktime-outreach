"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, CalendarClock, Check, Copy, PhoneOff, RotateCcw, X } from "lucide-react";
import clsx from "clsx";
import { client } from "@/lib/api";
import { clockTime, dayAndTime, duration } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import type { CallJson, TranscriptLineJson } from "@/lib/types";
import { StatusChip } from "./status-chip";

const isOpen = (call: CallJson) => call.status === "dialing" || call.status === "live";

function Fact({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="text-sm text-gray-900">{value}</dd>
    </div>
  );
}

const yesNo = (value: boolean | null) => (value == null ? null : value ? "Yes" : "No");

function Transcript({ lines, live, agentName }: { lines: TranscriptLineJson[]; live: boolean; agentName: string }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (live) end.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [lines.length, live]);

  if (!lines.length) {
    return (
      <p className="py-8 text-center text-sm text-gray-500">
        {live ? "The conversation will appear here as it happens." : "Nothing was said on this call."}
      </p>
    );
  }
  return (
    <ol className="space-y-2.5" aria-live={live ? "polite" : "off"}>
      {lines.map((line) =>
        line.role === "system" ? (
          <li key={line._id} className="text-center text-xs text-gray-500">
            {line.text}
          </li>
        ) : (
          <li key={line._id} className={clsx("flex flex-col", line.role === "agent" ? "items-end" : "items-start")}>
            <span className="mb-0.5 text-[11px] text-gray-400">
              {line.role === "agent" ? agentName : "They said"} · {clockTime(line.at)}
            </span>
            <span
              className={clsx(
                "max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed",
                line.role === "agent" ? "rounded-br-sm bg-gray-900 text-white" : "rounded-bl-sm bg-gray-100 text-gray-900",
              )}
            >
              {line.text}
            </span>
          </li>
        ),
      )}
      <div ref={end} />
    </ol>
  );
}

function transcriptText(call: CallJson, lines: TranscriptLineJson[], agentName: string): string {
  const title = call.label || formatPhone(call.phone);
  const rows = lines.map((line) => {
    const speaker = line.role === "agent" ? agentName : line.role === "callee" ? "Restaurant" : "System";
    return `${speaker} · ${clockTime(line.at)}\n${line.text}`;
  });
  return [`Call transcript — ${title}`, formatPhone(call.phone), "", ...rows].join("\n\n");
}

export function CallDetail({
  callId,
  repFirstName,
  agentName,
  onSelect,
}: {
  callId: string | null;
  repFirstName: string;
  agentName: string;
  onSelect: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["call", callId],
    queryFn: () => client.call(callId as string),
    enabled: !!callId,
    // A call on the line is re-read every second and a half; a finished one a few more times for its recording.
    refetchInterval: (query) => {
      const call = query.state.data?.call;
      if (!call) return false;
      if (isOpen(call) || call.status === "queued") return 1500;
      return call.recording || call.simulated ? false : 5000;
    },
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["calls"] });
    queryClient.invalidateQueries({ queryKey: ["queue"] });
    queryClient.invalidateQueries({ queryKey: ["call", callId] });
  };
  const cancel = useMutation({ mutationFn: () => client.cancelCall(callId as string), onSuccess: refresh });
  const [recallAt, setRecallAt] = useState("");
  const [copied, setCopied] = useState(false);
  const again = useMutation({
    mutationFn: (at?: string) => client.callAgain(callId as string, at),
    onSuccess: (result) => {
      refresh();
      onSelect(result.callId);
    },
  });
  const block = useMutation({
    mutationFn: (phone: string) => client.addDnc(phone, "Added from a call"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["dnc"] }),
  });

  if (!callId) {
    return <div className="card px-4 py-10 text-center text-sm text-gray-500">Pick a call to see the conversation.</div>;
  }
  if (isLoading || !data) return <div className="card h-64 animate-pulse" />;

  const { call, transcript } = data;
  const open = isOpen(call);
  const failure = cancel.error || again.error || block.error;
  const copyTranscript = async () => {
    await navigator.clipboard.writeText(transcriptText(call, transcript, agentName));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    // One scroll for the whole panel: the summary and recording scroll away and the
    // transcript keeps its full height. The header (name, status, actions) stays put.
    <article className="card max-h-[calc(100vh-190px)] min-h-[320px] overflow-y-auto">
      <header className="sticky top-0 z-10 rounded-t-lg border-b border-gray-100 bg-white p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-gray-900">{call.label || formatPhone(call.phone)}</h2>
            <p className="text-sm text-gray-500">{formatPhone(call.phone)}</p>
          </div>
          <StatusChip call={call} repFirstName={repFirstName} />
        </div>
        <p className="mt-2 text-xs text-gray-500">
          {[
            call.startedAt ? `Started ${dayAndTime(call.startedAt)}` : `Added ${dayAndTime(call.queuedAt)}`,
            call.durationSec != null ? `talked ${duration(call.durationSec)}` : null,
            call.attempt > 1 ? `try ${call.attempt}` : null,
            call.direction === "inbound" ? "they called us back" : null,
            call.simulated ? "acted out, no phone rang" : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {call.status === "queued" && (
            <button type="button" className="btn-secondary" disabled={cancel.isPending} onClick={() => cancel.mutate()}>
              <X className="h-4 w-4" />
              Remove from queue
            </button>
          )}
          {open && (
            <button type="button" className="btn-danger" disabled={cancel.isPending} onClick={() => cancel.mutate()}>
              <PhoneOff className="h-4 w-4" />
              Hang up
            </button>
          )}
          {(call.status === "ended" || call.status === "cancelled") && (
            <button type="button" className="btn-secondary" disabled={again.isPending} onClick={() => again.mutate(undefined)}>
              <RotateCcw className="h-4 w-4" />
              Call again
            </button>
          )}
          {(call.status === "ended" || call.status === "cancelled") && (
            <span className="flex items-center gap-1.5">
              <input
                type="datetime-local"
                aria-label="Call again at"
                value={recallAt}
                onChange={(e) => setRecallAt(e.target.value)}
                className="field w-auto py-1.5 text-xs"
              />
              <button
                type="button"
                className="btn-secondary"
                disabled={again.isPending || !recallAt}
                onClick={() => again.mutate(new Date(recallAt).toISOString())}
              >
                <CalendarClock className="h-4 w-4" />
                Schedule
              </button>
            </span>
          )}
          {call.outcome !== "do_not_call" && (
            <button type="button" className="btn-secondary" disabled={block.isPending || block.isSuccess} onClick={() => block.mutate(call.phone)}>
              <Ban className="h-4 w-4" />
              {block.isSuccess ? "Will not be called" : "Never call this number"}
            </button>
          )}
        </div>
        {failure && (
          <p role="alert" className="mt-2 text-xs text-red-700">
            {(failure as Error).message}
          </p>
        )}
      </header>

      {(call.summary || call.error || call.contactName || call.callbackTime || call.bookingSystem || call.ownerReached != null || call.takesLargeBookings != null || call.seats != null || call.interestedInSystem != null) && (
        <section className="border-b border-gray-100 p-4">
          {call.summary && <p className="text-sm leading-relaxed text-gray-800">{call.summary}</p>}
          {call.error && <p className="text-sm text-red-700">{call.error}</p>}
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 empty:hidden">
            <Fact label="Spoke to the owner" value={yesNo(call.ownerReached)} />
            <Fact label="Interested" value={yesNo(call.interested)} />
            <Fact label="Takes large bookings" value={yesNo(call.takesLargeBookings)} />
            <Fact
              label="Capacity"
              value={call.seats != null ? `${call.seats} seats${call.capacityNote ? ` (${call.capacityNote})` : ""}` : call.capacityNote}
            />
            <Fact label="Vegetarian / vegan" value={call.vegetarianVegan} />
            <Fact label="Wants to hear about the AI phone assistant" value={yesNo(call.interestedInSystem)} />
            <Fact label="Name" value={call.contactName} />
            <Fact label="Owner is free" value={call.callbackTime} />
            <Fact label="Booking system" value={call.bookingSystem} />
          </dl>
        </section>
      )}

      {call.recording?.url && (
        <section className="border-b border-gray-100 p-4">
          <h3 className="mb-2 text-xs font-medium text-gray-700">Recording</h3>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption -- the transcript below is the caption */}
          <audio controls preload="none" src={call.recording.url} className="w-full" />
        </section>
      )}

      <section className="p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="text-xs font-medium text-gray-700">Conversation</h3>
          {!!transcript.length && (
            <button type="button" className="btn-secondary px-2.5 py-1.5 text-xs" onClick={() => void copyTranscript()}>
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copied" : "Copy transcript"}
            </button>
          )}
        </div>
        <Transcript lines={transcript} live={open} agentName={agentName} />
      </section>
    </article>
  );
}
