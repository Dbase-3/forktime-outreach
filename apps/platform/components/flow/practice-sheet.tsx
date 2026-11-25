"use client";

// "Try it": the customer plays the caller and sees exactly which path the flow takes.

import clsx from "clsx";
import { RotateCcw, Send } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { humanize } from "@/lib/format";
import { answerPractice, startPractice, type PracticeState } from "@/lib/practice";
import type { Contact, Flow } from "@/lib/types";
import { Badge, Sheet } from "../ui";

export function PracticeSheet({ open, onClose, flow, business, contacts }: { open: boolean; onClose: () => void; flow: Flow; business: string; contacts: Contact[] }) {
  const [contactId, setContactId] = useState(contacts[0]?.id ?? "");
  const contact = contacts.find((c) => c.id === contactId);
  const begin = useMemo(
    () => () => startPractice(flow, { agentName: flow.agent.name, business, contactFields: contact?.fields ?? {} }),
    [flow, business, contact],
  );
  const [state, setState] = useState<PracticeState>(begin);
  useEffect(() => {
    if (open) setState(begin());
  }, [open, begin]);

  return (
    <Sheet open={open} onClose={onClose} title="Try this flow" wide footer={<Reply state={state} onAnswer={(a) => setState((s) => answerPractice(s, a))} onRestart={() => setState(begin())} />}>
      {contacts.length > 0 && (
        <label className="mb-4 flex items-center gap-2 text-sm text-fg-3">
          Calling as
          <select className="field w-auto py-1.5" value={contactId} onChange={(e) => setContactId(e.target.value)}>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
      )}
      <Transcript state={state} />
    </Sheet>
  );
}

function Transcript({ state }: { state: PracticeState }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ behavior: "smooth", block: "end" }), [state.lines.length]);
  return (
    <div className="space-y-2.5">
      {state.lines.map((line, i) => {
        if (line.who === "system") {
          return (
            <div key={i} className="flex justify-center">
              <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">{line.text}</span>
            </div>
          );
        }
        return (
          <div key={i} className={clsx("flex", line.who === "caller" && "justify-end")}>
            <div className={clsx("max-w-[85%] rounded-xl px-3.5 py-2 text-sm leading-snug", line.who === "agent" ? "rounded-tl-md bg-muted text-fg" : "rounded-tr-md bg-fg text-background")}>
              {line.text}
            </div>
          </div>
        );
      })}
      {state.outcome && (
        <div className="flex justify-center pt-2">
          <Badge tone={state.outcome === "no_ending" ? "amber" : "brand"}>Call ended · {humanize(state.outcome)}</Badge>
        </div>
      )}
      <div ref={end} />
    </div>
  );
}

function Reply({ state, onAnswer, onRestart }: { state: PracticeState; onAnswer: (answer: string) => void; onRestart: () => void }) {
  const [text, setText] = useState("");
  const ask = state.waitingFor;
  if (!ask) {
    return (
      <button type="button" className="btn-secondary w-full" onClick={onRestart}>
        <RotateCcw size={16} /> Start again
      </button>
    );
  }
  const quick = ask.answerType === "yesno" ? ["Yes", "No"] : ask.answerType === "choice" ? ask.choices ?? [] : [];
  const send = (value: string) => {
    if (!value.trim()) return;
    onAnswer(value);
    setText("");
  };
  return (
    <div className="space-y-2">
      {quick.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {quick.map((option) => (
            <button key={option} type="button" className="rounded-full border border-line px-3 py-1.5 text-sm hover:bg-subtle" onClick={() => send(option)}>
              {option}
            </button>
          ))}
        </div>
      )}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          send(text);
        }}
      >
        <input className="field" value={text} onChange={(e) => setText(e.target.value)} placeholder="Answer as the caller…" type={ask.answerType === "date" ? "date" : ask.answerType === "number" ? "number" : "text"} />
        <button type="submit" className="btn-primary px-3" aria-label="Send">
          <Send size={16} />
        </button>
      </form>
    </div>
  );
}
