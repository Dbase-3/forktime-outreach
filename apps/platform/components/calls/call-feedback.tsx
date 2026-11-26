"use client";

// "How did the AI handle this call?" The thumb saves at once; on a thumbs
// down, reasons and a note are an optional second step. Tapping your thumb
// again takes it back. Same reasons as the Forktime dashboard.

import clsx from "clsx";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { FEEDBACK_REASONS, NOTE_MAX } from "@outreach/core/call-review";
import { ws } from "@/lib/api";
import { nowIso, useApp } from "@/lib/store";
import type { Call, CallFeedback, FeedbackReason } from "@outreach/core/types";
import { callKey, type CallDetail } from "../call-sheet";

/** Shows the rating at once, saves it, and puts it back if the save fails. */
function useSaveFeedback() {
  const queries = useQueryClient();
  const { workspace } = useApp();
  const [problem, setProblem] = useState<string | null>(null);
  const save = async (callId: string, feedback: CallFeedback | null) => {
    const key = callKey(workspace.id, callId);
    const before = queries.getQueryData<CallDetail>(key);
    if (before) queries.setQueryData<CallDetail>(key, { ...before, call: { ...before.call, feedback: feedback ?? undefined } });
    setProblem(null);
    try {
      await ws(`/calls/${callId}/feedback`, { method: "PATCH", body: { feedback } });
      void queries.invalidateQueries({ queryKey: ["calls", workspace.id] });
    } catch (err) {
      if (before) queries.setQueryData(key, before);
      setProblem(err instanceof Error ? err.message : "Couldn't save your rating.");
    }
  };
  return { save, problem };
}

export function CallFeedbackBar({ call }: { call: Call }) {
  const mine = call.feedback ?? null;
  const { save: saveNow, problem } = useSaveFeedback();
  const save = (callId: string, feedback: CallFeedback | null) => void saveNow(callId, feedback);
  const [open, setOpen] = useState(false);
  const [reasons, setReasons] = useState<FeedbackReason[]>(mine?.reasons ?? []);
  const [note, setNote] = useState(mine?.note ?? "");

  // A different call resets the draft.
  useEffect(() => {
    setReasons(call.feedback?.reasons ?? []);
    setNote(call.feedback?.note ?? "");
    setOpen(false);
  }, [call.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (rating: CallFeedback["rating"]) => {
    if (mine?.rating === rating) {
      save(call.id, null);
      setOpen(false);
      return;
    }
    save(call.id, { rating, reasons: [], note: "", at: nowIso() });
    setReasons([]);
    setNote("");
    setOpen(rating === "down");
  };
  const send = () => {
    if (!mine) return;
    save(call.id, { ...mine, reasons: mine.rating === "down" ? reasons : [], note: note.trim(), at: nowIso() });
    setOpen(false);
  };
  const toggleReason = (key: FeedbackReason) => setReasons((rs) => (rs.includes(key) ? rs.filter((r) => r !== key) : [...rs, key]));

  return (
    <div className="mt-3 rounded-lg border border-line bg-surface px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium">How did the AI handle this call?</p>
        <div className="flex items-center gap-1">
          <Thumb label="This went well" on={mine?.rating === "up"} tone="up" onClick={() => pick("up")}>
            <ThumbsUp size={15} className={clsx(mine?.rating === "up" && "fill-current")} />
          </Thumb>
          <Thumb label="Something went wrong" on={mine?.rating === "down"} tone="down" onClick={() => pick("down")}>
            <ThumbsDown size={15} className={clsx(mine?.rating === "down" && "fill-current")} />
          </Thumb>
        </div>
      </div>

      {mine && open && (
        <div className="mt-3 space-y-2.5">
          {mine.rating === "down" && (
            <>
              <p className="text-xs font-medium text-fg-2">
                What went wrong? <span className="font-normal text-fg-3">(optional)</span>
              </p>
              <div className="flex flex-wrap gap-1.5">
                {FEEDBACK_REASONS.map((r) => {
                  const on = reasons.includes(r.key);
                  return (
                    <button
                      key={r.key}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleReason(r.key)}
                      className={clsx("h-7 rounded-full border px-2.5 text-xs font-medium transition-colors", on ? "border-fg bg-fg text-background" : "border-line text-fg-2 hover:border-line-strong")}
                    >
                      {r.label}
                    </button>
                  );
                })}
              </div>
            </>
          )}
          <textarea
            className="field resize-none"
            rows={2}
            value={note}
            maxLength={NOTE_MAX}
            onChange={(e) => setNote(e.target.value)}
            placeholder={mine.rating === "down" ? "What should it have done? (optional)" : "Anything it did really well? (optional)"}
          />
          <div className="flex items-center gap-3">
            <button type="button" className="btn-primary h-8" onClick={send}>Send</button>
            <button type="button" className="text-sm text-fg-3 hover:text-fg" onClick={() => setOpen(false)}>{mine.rating === "down" ? "Skip" : "Cancel"}</button>
          </div>
        </div>
      )}

      {problem && <p className="mt-1.5 text-xs text-rose-700 dark:text-rose-400">{problem}</p>}
      {mine && !open && (
        <div className="mt-1.5 text-xs text-fg-3">
          {mine.rating === "up" ? "Thanks, glad it went well." : "Thanks. We'll use this to improve the agent."}{" "}
          {mine.reasons.length > 0 && <span className="text-fg-2">{mine.reasons.map((k) => FEEDBACK_REASONS.find((r) => r.key === k)?.label).join(" · ")}. </span>}
          {mine.note && <span className="italic text-fg-2">&ldquo;{mine.note}&rdquo; </span>}
          <button type="button" className="font-medium text-fg-2 underline-offset-2 hover:underline" onClick={() => setOpen(true)}>
            {mine.note || mine.reasons.length ? "Edit details" : mine.rating === "up" ? "Add a note" : "Add details"}
          </button>
        </div>
      )}
    </div>
  );
}

function Thumb({ label, on, tone, onClick, children }: { label: string; on: boolean; tone: "up" | "down"; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      aria-label={label}
      title={label}
      className={clsx(
        "inline-flex h-8 w-9 items-center justify-center rounded-lg border transition-colors",
        !on && "border-line text-fg-3 hover:border-line-strong hover:text-fg",
        on && tone === "up" && "border-emerald-500 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
        on && tone === "down" && "border-rose-500 bg-rose-500/10 text-rose-700 dark:text-rose-400",
      )}
    >
      {children}
    </button>
  );
}
