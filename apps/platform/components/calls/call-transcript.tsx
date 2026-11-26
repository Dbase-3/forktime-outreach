"use client";

// The Transcript tab. On a recorded call the line being spoken lights up and
// scrolls into view (only when it's out of sight), and clicking a line jumps
// the recording there. "Follow audio" is on by default and only its switch
// turns it off: an idle scroll silently switching it off reads as broken.

import clsx from "clsx";
import { AudioLines, Bot, Lightbulb, User, Zap } from "lucide-react";
import { useEffect, useRef } from "react";
import { clock } from "@outreach/core/call-review";
import type { TranscriptLine } from "@outreach/core/types";

interface Props {
  lines: TranscriptLine[];
  agentName: string;
  activeIndex: number;
  following: boolean;
  onFollowingChange: (next: boolean) => void;
  canSeek: boolean;
  onSeek: (sec: number) => void;
  live?: boolean;
}

export function CallTranscript({ lines, agentName, activeIndex, following, onFollowingChange, canSeek, onSeek, live }: Props) {
  const rows = useRef<(HTMLDivElement | null)[]>([]);

  // Scroll only when the lit line is out of sight, and then to the middle, so
  // a glance around (or a line already on screen) moves nothing.
  useEffect(() => {
    if (!following || activeIndex < 0) return;
    const row = rows.current[activeIndex];
    const box = row?.closest<HTMLElement>(".overflow-y-auto");
    if (!row || !box) return;
    const r = row.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    const margin = 24;
    if (r.top >= b.top + margin && r.bottom <= b.bottom - margin) return;
    row.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeIndex, following]);

  if (lines.length === 0) return <p className="py-10 text-center text-sm text-fg-3">No transcript for this call.</p>;

  return (
    <div>
      {canSeek && (
        <div className="mb-4 flex items-center justify-between gap-3 border-b border-line pb-3">
          <span className="text-xs text-fg-3">Click a line to jump there.</span>
          <button
            type="button"
            onClick={() => onFollowingChange(!following)}
            aria-pressed={following}
            title={following ? "The transcript follows the recording" : "Highlight and scroll to each line as the recording plays"}
            className={clsx("inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors", following ? "border-accent/40 bg-accent/10 text-accent" : "border-line text-fg-3 hover:bg-subtle")}
          >
            <AudioLines size={14} className={clsx(following && "animate-pulse")} /> Follow audio
          </button>
        </div>
      )}
      <div className="space-y-1">
        {lines.map((line, i) => {
          const seekable = canSeek && line.at !== undefined;
          const active = activeIndex === i;
          return (
            <div
              key={i}
              ref={(el) => {
                rows.current[i] = el;
              }}
              className={clsx("-mx-2 rounded-xl px-2 py-1.5 transition-colors", active && "bg-accent/10 ring-1 ring-inset ring-accent/30", seekable && !active && "cursor-pointer hover:bg-subtle")}
              {...(seekable
                ? {
                    role: "button" as const,
                    tabIndex: 0,
                    title: "Jump to this moment",
                    onClick: () => onSeek(line.at as number),
                    onKeyDown: (e: React.KeyboardEvent) => {
                      if (e.key !== "Enter" && e.key !== " ") return;
                      e.preventDefault();
                      onSeek(line.at as number);
                    },
                  }
                : {})}
            >
              <Line line={line} agentName={agentName} />
            </div>
          );
        })}
        {live && (
          <div className="flex items-center gap-2 px-1 pt-2 text-xs text-fg-3">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
              <span className="relative h-1.5 w-1.5 rounded-full bg-emerald-500" />
            </span>
            Call in progress
          </div>
        )}
      </div>
    </div>
  );
}

function Line({ line, agentName }: { line: TranscriptLine; agentName: string }) {
  if (line.who === "action") {
    return (
      <div className="flex justify-center">
        <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-800 dark:text-emerald-300">
          <Zap size={12} className="shrink-0" />
          <span className="truncate">{line.text}</span>
        </span>
      </div>
    );
  }
  const caller = line.who === "caller";
  return (
    <div className={clsx("flex", caller && "justify-end")}>
      <div className="max-w-[82%]">
        <div className={clsx("mb-1 flex items-center gap-1.5 text-xs text-fg-3", caller && "justify-end")}>
          {caller ? <User size={12} /> : <Bot size={12} />}
          {caller ? "Caller" : agentName}
          {line.at !== undefined && <span className="font-mono text-fg-4">{clock(line.at)}</span>}
        </div>
        <div className={clsx("rounded-2xl px-3.5 py-2 text-sm leading-snug", caller ? "rounded-tr-md bg-fg text-background" : "rounded-tl-md bg-muted text-fg")}>{line.text}</div>
        {line.reason && (
          <div className="mt-1 flex items-start gap-1.5 pl-1 text-xs italic leading-snug text-fg-3" title="The agent's own one-line reason for this reply, kept for review">
            <Lightbulb size={12} className="mt-0.5 shrink-0 text-amber-500" />
            <span>Why: {line.reason}</span>
          </div>
        )}
      </div>
    </div>
  );
}
