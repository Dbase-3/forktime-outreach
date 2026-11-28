"use client";

// "Start from scratch" (owner 2026-11-28): one box, "What should this agent
// do?", with example requests typing themselves into the empty box and a few to
// click, so people see what agents can do. Build = create it and let AI write
// it at once (the editor picks the description up); Skip = a blank agent. No
// name or number here: it gets a random starter name and no number, both set
// later in Config. Nothing here is required.

import { Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { randomAgentName } from "@outreach/core/numbers";
import { BRIEF_MAX } from "@outreach/core/schemas";
import { createAgent } from "@/lib/actions";
import { useApp } from "@/lib/store";
import { Modal } from "../ui";

/** What an agent can do, as people would ask for it. Shown typing in the empty box and as one-click starts. */
export const EXAMPLE_BRIEFS = [
  { label: "Book appointments", text: "Answer calls for my dental clinic, book check-ups in my Cal.com calendar and save new patients to GoHighLevel." },
  { label: "Qualify leads", text: "Call new leads from my list, ask their budget and when they want to buy, and book a demo with the ones who are ready." },
  { label: "Answer questions", text: "Answer questions about our opening hours, prices and services from our website, and take a message when we're closed." },
  { label: "Confirm bookings", text: "Call customers the day before their appointment to confirm it, and move it to a new time if they can't make it." },
  { label: "Save to my CRM", text: "Take enquiries for our real estate agency: get their name, phone, email and what they're looking for, and save them to Twenty." },
];

const EXAMPLE_TEXTS = EXAMPLE_BRIEFS.map((e) => e.text); // stable, so the typing doesn't restart each render

/** The minimum Write with AI accepts. */
const MIN_BRIEF = 8;

export function CreateAgentModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const app = useApp();
  const router = useRouter();
  const [brief, setBrief] = useState("");
  const [busy, setBusy] = useState<null | "build" | "skip">(null);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const hint = useTypingHint(open && !brief, EXAMPLE_TEXTS);

  useEffect(() => {
    if (!open) return;
    setBrief("");
    setError(null);
    setBusy(null);
  }, [open]);

  const start = async (how: "build" | "skip") => {
    if (busy) return;
    const text = how === "build" ? brief.trim().slice(0, BRIEF_MAX) : "";
    if (how === "build" && text.length < MIN_BRIEF) return;
    setBusy(how);
    setError(null);
    try {
      const flow = await createAgent({ templateId: null, name: randomAgentName(app.flows.map((f) => f.name)) });
      onClose();
      // The editor writes the agent from `describe` straight away (and drops it from the address).
      router.push(text ? `/agents/${flow.id}?describe=${encodeURIComponent(text)}` : `/agents/${flow.id}?blank=1`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the agent.");
      setBusy(null);
    }
  };
  const ready = brief.trim().length >= MIN_BRIEF;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="What should this agent do?"
      description="Describe it in a sentence or two and AI builds it. Or skip and build it yourself."
      footer={
        <div className="flex items-center justify-between gap-2">
          <button type="button" className="btn-ghost" onClick={() => void start("skip")} disabled={busy !== null}>
            {busy === "skip" ? "Creating…" : "Skip, start blank"}
          </button>
          <button type="button" className="btn-primary" onClick={() => void start("build")} disabled={!ready || busy !== null}>
            <Sparkles size={15} aria-hidden /> {busy === "build" ? "Creating…" : "Build agent"}
          </button>
        </div>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void start("build");
        }}
      >
        <div className="relative">
          <textarea
            ref={box}
            className="field min-h-[7.5rem] resize-none py-2.5 leading-relaxed"
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            onKeyDown={(e) => {
              // Enter builds (Shift+Enter for a new line), like a chat box.
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void start("build");
              }
            }}
            maxLength={BRIEF_MAX}
            autoFocus
            aria-label="What this agent should do"
            placeholder={hint}
          />
        </div>
        <div>
          <div className="mb-2 text-xs text-fg-3">Or start from one of these:</div>
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLE_BRIEFS.map((e) => (
              <button
                key={e.label}
                type="button"
                className="rounded-full border border-line bg-surface px-3 py-1.5 text-sm text-fg-2 transition-colors hover:border-line-strong hover:text-fg"
                onClick={() => {
                  setBrief(e.text);
                  box.current?.focus();
                }}
              >
                {e.label}
              </button>
            ))}
          </div>
        </div>
        {error && <p className="text-sm text-rose-700 dark:text-rose-400" role="alert">{error}</p>}
      </form>
    </Modal>
  );
}

/**
 * Example requests typed into the empty box one letter at a time, held, then
 * the next. With reduced motion they just change every few seconds. Only runs
 * while `on` (open and empty).
 */
function useTypingHint(on: boolean, examples: string[]): string {
  const [shown, setShown] = useState(`e.g. ${examples[0]}`);
  useEffect(() => {
    if (!on) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let i = 0;
    let n = 0;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const full = `e.g. ${examples[i]}`;
      if (still) {
        setShown(full);
        i = (i + 1) % examples.length;
        timer = setTimeout(tick, 4000);
        return;
      }
      n += 1;
      setShown(full.slice(0, n));
      if (n < full.length) timer = setTimeout(tick, 28);
      else {
        i = (i + 1) % examples.length;
        n = 0;
        timer = setTimeout(tick, 2600); // hold the whole line, then type the next
      }
    };
    tick();
    return () => clearTimeout(timer);
  }, [on, examples]);
  return shown;
}
