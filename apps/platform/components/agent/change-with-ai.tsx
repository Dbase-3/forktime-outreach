"use client";

// "Change with AI", docked under the agent's setup (owner 2026-11-27): say a
// change in plain words ("ask their budget", "at the end save to GoHighLevel")
// and the AI makes it through small, checked edits on the server. Each answer
// lists what changed, flags anything that needs an integration that isn't
// connected (with Connect), and the latest can be undone. A blank agent is
// written whole from the first message. Building lives on the left; trying
// the agent lives on the right (Preview), so the two never mix.

import clsx from "clsx";
import { AlertTriangle, ArrowUp, Check, ChevronDown, ChevronUp, Loader2, Sparkles, Undo2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { missingIntegrations, type Missing } from "@outreach/core/agent-edits";
import { BRIEF_MAX } from "@outreach/core/schemas";
import type { Flow } from "@outreach/core/types";
import { ApiError, ws } from "@/lib/api";
import { flush, useApp } from "@/lib/store";
import { ConnectSheet } from "../integrations";

/** The parts of an agent a change can touch: what Undo puts back. */
const PARTS = ["name", "description", "direction", "agent", "greeting", "business", "prompt", "steps", "dataFields", "askRequired", "checks", "tools", "knowledgeIds", "afterCall"] as const;
export type AgentParts = Pick<Flow, (typeof PARTS)[number]>;
export const partsOf = (f: Flow): AgentParts => Object.fromEntries(PARTS.map((k) => [k, f[k]])) as AgentParts;

type Turn = { who: "you"; text: string } | { who: "ai"; reply: string; changes: string[]; undo: AgentParts | null; undone?: boolean } | { who: "error"; text: string };

type Result = { draft: AgentParts; changes: string[]; reply: string; needs: Missing[] };

export function ChangeWithAi({
  flow,
  onApply,
  onWriteWhole,
  writing,
  focus,
}: {
  flow: Flow;
  onApply: (parts: Partial<AgentParts>) => void;
  onWriteWhole: (brief: string) => Promise<string | null>;
  writing: boolean;
  focus?: boolean;
}) {
  const app = useApp();
  const [text, setText] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(true);
  const [shown, setShown] = useState(true);
  const [connect, setConnect] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const blank = flow.steps.length === 0;
  const working = busy || writing;

  // Closed stays closed on this browser (read after mount, so the server's first paint matches).
  useEffect(() => {
    if (readClosed()) setShown(false);
  }, []);
  const show = (on: boolean) => {
    setShown(on);
    saveClosed(!on);
    if (on) setTimeout(() => box.current?.focus(), 0);
  };

  useEffect(() => {
    if (!focus) return;
    setShown(true);
    setTimeout(() => box.current?.focus(), 0);
  }, [focus]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [turns.length, working]);

  // What still needs connecting, read fresh: connecting one clears it at once.
  const connected = app.integrations.filter((i) => i.connected).map((i) => i.id);
  const needs = missingIntegrations(flow, connected);
  const needNames = [...new Map(needs.map((m) => [m.integration, m])).values()];

  async function send() {
    const message = text.trim();
    if (message.length < 2 || working) return;
    setText("");
    setOpen(true);
    setTurns((t) => [...t, { who: "you", text: message }]);
    if (blank) {
      // Nothing to change yet: write the whole agent from the description.
      const before = partsOf(flow);
      const problem = await onWriteWhole(message);
      setTurns((t) => [
        ...t,
        problem
          ? { who: "error", text: problem }
          : { who: "ai", reply: "I wrote the agent: its instructions, welcome message and workflow. Check the Workflow, then try it in Preview.", changes: [], undo: before },
      ]);
      return;
    }
    setBusy(true);
    try {
      await flush(); // the AI changes the agent as saved: send any edits first
      const history = turns
        .flatMap((t): { role: "user" | "assistant"; text: string }[] => (t.who === "you" ? [{ role: "user", text: t.text }] : t.who === "ai" ? [{ role: "assistant", text: t.reply }] : []))
        .slice(-10);
      const res = await ws<Result>(`/agents/${flow.id}/builder`, { body: { message, history } });
      const before = partsOf(flow);
      if (res.changes.length) onApply(res.draft);
      setTurns((t) => [...t.map((x) => (x.who === "ai" ? { ...x, undo: null } : x)), { who: "ai", reply: res.reply, changes: res.changes, undo: res.changes.length ? before : null }]);
    } catch (err) {
      setTurns((t) => [...t, { who: "error", text: err instanceof ApiError ? err.message : "Couldn't reach the AI. Try again." }]);
    } finally {
      setBusy(false);
      box.current?.focus();
    }
  }

  const undo = (i: number) => {
    const turn = turns[i];
    if (turn.who !== "ai" || !turn.undo) return;
    onApply(turn.undo);
    setTurns((t) => t.map((x, j) => (j === i && x.who === "ai" ? { ...x, undo: null, undone: true } : x)));
  };

  const title = blank ? "Describe your agent" : "Change with AI";
  const subtitle = blank ? "Say what it should do and AI builds it." : "Ask for any change in plain words.";

  // Closed: a slim bar in the same theme, one click to open again.
  if (!shown) {
    return (
      <div className="ai-card ai-bar shrink-0">
        <button type="button" onClick={() => show(true)} className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm transition-colors hover:bg-muted" aria-expanded={false}>
          <Sparkles size={15} className="ai-twinkle shrink-0 text-accent" aria-hidden />
          <span className="font-medium text-fg">{title}</span>
          <span className="min-w-0 flex-1 truncate text-fg-3">{subtitle}</span>
          {working ? <Loader2 size={14} className="shrink-0 animate-spin text-fg-3" /> : <ChevronUp size={15} className="shrink-0 text-fg-3" />}
        </button>
        <ConnectSheet id={connect} onClose={() => setConnect(null)} />
      </div>
    );
  }

  return (
    <div className="shrink-0 p-3 pt-2">
      <div className="ai-ring">
        <div className="ai-card overflow-hidden rounded-2xl">
          <div className="flex items-start gap-2 px-4 pt-3">
            <Sparkles size={16} className="ai-twinkle mt-0.5 shrink-0 text-accent" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-fg">{title}</p>
              <p className="text-xs text-fg-3">{subtitle}</p>
            </div>
            <button type="button" className="btn-icon -mr-2 -mt-1 h-7 w-7" onClick={() => show(false)} aria-label="Close">
              <X size={14} />
            </button>
          </div>
          {turns.length > 0 && (
            <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-1.5 px-4 pt-2 text-xs font-medium text-fg-3 hover:text-fg" aria-expanded={open}>
              {open ? <ChevronDown size={13} /> : <ChevronUp size={13} />} {open ? "Hide changes" : `Show changes (${turns.filter((t) => t.who === "ai").length})`}
            </button>
          )}
          {open && (turns.length > 0 || working) && (
            <div className="max-h-[40vh] space-y-2 overflow-y-auto px-4 pt-2">
              {turns.map((t, i) =>
                t.who === "you" ? (
                  <p key={i} className="ml-8 rounded-lg bg-surface px-3 py-2 text-sm text-fg shadow-[0_0_0_1px_rgb(var(--line))]">
                    {t.text}
                  </p>
                ) : t.who === "error" ? (
                  <p key={i} className="text-sm text-rose-700 dark:text-rose-400" role="alert">
                    {t.text}
                  </p>
                ) : (
                  <div key={i} className="mr-8 space-y-1.5 text-sm">
                    <p className="text-fg-2">{t.reply}</p>
                    {t.changes.length > 0 && (
                      <ul className={clsx("space-y-0.5", t.undone && "line-through opacity-60")}>
                        {t.changes.map((c, j) => (
                          <li key={j} className="flex gap-1.5 text-fg">
                            <Check size={14} className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" /> {c}
                          </li>
                        ))}
                      </ul>
                    )}
                    {t.undone && <p className="text-xs text-fg-3">Undone.</p>}
                    {t.undo && (
                      <button type="button" className="btn-ghost h-7 px-2 text-xs" onClick={() => undo(i)}>
                        <Undo2 size={13} /> Undo
                      </button>
                    )}
                  </div>
                ),
              )}
              {working && (
                <div className="flex items-center gap-2 text-sm text-fg-3">
                  <Loader2 size={14} className="animate-spin" /> {blank ? "Writing your agent… about 20 seconds." : "Making the change…"}
                </div>
              )}
              <div ref={end} />
            </div>
          )}

          {needNames.length > 0 && (
            <div className="mx-4 mt-2 space-y-1">
              {needNames.map((m) => (
                <div key={m.integration} className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-900 dark:text-amber-200">
                  <AlertTriangle size={13} className="shrink-0" />
                  <span className="flex-1">{m.name} isn&apos;t connected. Test calls skip it, and the agent can&apos;t go live until it is.</span>
                  <button type="button" className="btn-secondary h-7 px-2 text-xs" onClick={() => setConnect(m.integration)}>
                    Connect
                  </button>
                </div>
              ))}
            </div>
          )}

          <form
            className="p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <div className="flex items-end gap-2 rounded-xl border border-line bg-surface p-1.5 pl-3 transition-colors focus-within:border-fg-3 focus-within:ring-[3px] focus-within:ring-fg/5">
              <Sparkles size={15} className="mb-2 shrink-0 text-accent" aria-hidden />
              <textarea
                ref={box}
                rows={1}
                maxLength={BRIEF_MAX}
                className="max-h-32 min-h-[34px] flex-1 resize-none bg-transparent py-1.5 text-[16px] leading-snug text-fg outline-none placeholder:text-fg-4 sm:text-sm"
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  e.target.style.height = "auto";
                  e.target.style.height = `${Math.min(e.target.scrollHeight, 128)}px`;
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                placeholder={blank ? "Describe what this agent should do…" : "Describe a change… e.g. ask their budget, and save them to GoHighLevel at the end"}
                aria-label={blank ? "What this agent should do" : "Change with AI"}
                disabled={working}
              />
              <button type="submit" className="btn-primary h-8 w-8 shrink-0 px-0" disabled={working || text.trim().length < 2} aria-label={blank ? "Write the agent" : "Make the change"}>
                {working ? <Loader2 size={15} className="animate-spin" /> : <ArrowUp size={15} />}
              </button>
            </div>
          </form>
        </div>
      </div>

      <ConnectSheet id={connect} onClose={() => setConnect(null)} />
    </div>
  );
}

const CLOSED_KEY = "ft.aiDockClosed";
function readClosed(): boolean {
  try {
    return localStorage.getItem(CLOSED_KEY) === "1";
  } catch {
    return false;
  }
}
function saveClosed(closed: boolean) {
  try {
    if (closed) localStorage.setItem(CLOSED_KEY, "1");
    else localStorage.removeItem(CLOSED_KEY);
  } catch {
    /* private window: it just opens next time */
  }
}
