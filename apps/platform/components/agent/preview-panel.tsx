"use client";

// Try the agent, ElevenLabs-style: talk to it for real (its voice, the same
// runtime that takes phone calls), or switch to chat to run the workflow in
// text. Either way the step the call is on lights up on the Workflow tab, and
// the record it will hand over fills in as you answer.

import clsx from "clsx";
import { RotateCcw, Send } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { dataSchema, structuredResult } from "@outreach/core/agent-data";
import { humanize } from "@outreach/core/format";
import { answerPractice, startPractice, type PracticeState } from "@outreach/core/practice";
import { readAnswer } from "@outreach/core/spoken";
import type { Contact, Flow } from "@outreach/core/types";
import { Badge, Segmented } from "../ui";
import { LiveVoice } from "./live-voice";

type Mode = "voice" | "chat";

export function PreviewPanel({ flow, business, contacts, onActiveStep }: { flow: Flow; business: string; contacts: Contact[]; onActiveStep: (id: string | null) => void }) {
  const [mode, setMode] = useState<Mode>("voice");
  const [picked, setPicked] = useState<string | null>(null); // "" = someone new, not a contact
  // Until they pick: an agent that answers calls hears from someone new (owner 2026-11-28: a test call run as
  // the first synced contact saved that contact to the CRMs); one that makes calls rings the first contact.
  const contactId = picked ?? (flow.direction === "outbound" ? contacts[0]?.id ?? "" : "");
  const contact = contacts.find((c) => c.id === contactId);
  const begin = useMemo(() => () => startPractice(flow, { agentName: flow.agent.name, business, contactFields: callValues(flow, contact) }), [flow, business, contact]);
  const [state, setState] = useState<PracticeState>(begin);
  const [voiceSaved, setVoiceSaved] = useState<Record<string, string>>({});
  const [voiceKey, setVoiceKey] = useState(0); // a new key starts the voice side over

  // A changed workflow or contact starts the chat over, so it always matches the screen.
  useEffect(() => {
    setState(begin());
  }, [begin]);
  useEffect(() => {
    if (mode === "chat") onActiveStep(state.currentId);
  }, [state.currentId, mode, onActiveStep]);
  useEffect(() => {
    return () => {
      onActiveStep(null);
    };
  }, [onActiveStep]);

  function answer(said: string) {
    const ask = state.waitingFor;
    if (!ask || !said.trim()) return;
    setState(answerPractice(state, said, readAnswer(ask, said)));
  }

  const onSaved = useCallback((values: Record<string, string>) => setVoiceSaved(values), []);
  const schema = dataSchema(flow);

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 space-y-2 border-b border-line px-4 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <Segmented<Mode> value={mode} onChange={(m) => { setMode(m); onActiveStep(null); setVoiceKey((k) => k + 1); }} options={[{ value: "voice", label: "Voice" }, { value: "chat", label: "Text" }]} />
          <button type="button" className="btn-ghost h-8 shrink-0 px-2 text-xs" onClick={() => (mode === "voice" ? setVoiceKey((k) => k + 1) : setState(begin()))}>
            <RotateCcw size={13} /> Restart
          </button>
        </div>
        <label className="flex items-center gap-2">
          <span className="shrink-0 text-xs text-fg-3">{flow.direction === "inbound" ? "Caller" : "Calling"}</span>
          <select className="field h-8 min-w-0 flex-1 py-0 text-sm" value={contactId} onChange={(e) => setPicked(e.target.value)} aria-label="Preview as contact">
            <option value="">Someone new (not a contact)</option>
            {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}{c.phone ? ` · ${c.phone}` : ""}</option>)}
          </select>
        </label>
      </div>

      {mode === "voice" ? (
        <LiveVoice key={voiceKey} flow={flow} contactId={contactId || null} onActiveStep={onActiveStep} onSaved={onSaved} />
      ) : (
        <ChatView state={state} onAnswer={answer} onRestart={() => setState(begin())} />
      )}

      {schema.length > 0 && <Collected schema={schema} values={mode === "voice" ? voiceSaved : state.values} />}
    </div>
  );
}

/** The variables a call fills in besides agent and business (see lib/variables.ts). */
function callValues(flow: Flow, contact: Contact | undefined): Record<string, string> {
  let today = "";
  try {
    today = new Intl.DateTimeFormat("en-AU", { timeZone: flow.timezone, weekday: "long", day: "numeric", month: "long" }).format(new Date());
  } catch {
    today = new Date().toDateString();
  }
  return { first_name: contact?.name.split(" ")[0] ?? "", name: contact?.name ?? "", phone: contact?.phone ?? "", today, ...(contact?.fields ?? {}) };
}

function AnswerBox({ ask, onSend, autoFocus }: { ask: NonNullable<PracticeState["waitingFor"]>; onSend: (v: string) => void; autoFocus?: boolean }) {
  const [text, setText] = useState("");
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!text.trim()) return;
        onSend(text);
        setText("");
      }}
    >
      <input
        className="field h-10"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Answer as the caller…"
        type={ask.answerType === "date" ? "date" : "text"}
        inputMode={ask.answerType === "number" ? "numeric" : undefined}
        autoFocus={autoFocus}
      />
      <button type="submit" className="btn-primary h-10 px-3" aria-label="Send"><Send size={15} /></button>
    </form>
  );
}

function ChatView({ state, onAnswer, onRestart }: { state: PracticeState; onAnswer: (v: string) => void; onRestart: () => void }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [state.lines.length]);
  const ask = state.waitingFor;
  const quick = ask?.answerType === "yesno" ? ["Yes", "No"] : ask?.answerType === "choice" ? ask.choices ?? [] : [];
  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-xl space-y-2 px-4 py-4">
          {state.lines.map((line, i) =>
            line.who === "system" ? (
              <div key={i} className="flex justify-center">
                <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-xs text-emerald-800 dark:text-emerald-300">{line.text}</span>
              </div>
            ) : (
              <div key={i} className={clsx("flex", line.who === "caller" && "justify-end")}>
                <div className={clsx("max-w-[85%] rounded-2xl px-3 py-1.5 text-sm leading-snug", line.who === "agent" ? "rounded-tl-md bg-muted" : "rounded-tr-md bg-fg text-background")}>{line.text}</div>
              </div>
            ),
          )}
          {state.outcome && (
            <div className="flex justify-center pt-1">
              <Badge tone={state.outcome === "no_ending" ? "amber" : "brand"}>Ended · {humanize(state.outcome)}</Badge>
            </div>
          )}
          <div ref={end} />
        </div>
      </div>
      <div className="border-t border-line p-3">
        <div className="mx-auto max-w-xl">
          {ask ? (
            <>
              {quick.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {quick.map((q) => (
                    <button key={q} type="button" className="h-7 rounded-full border border-line px-2.5 text-xs hover:bg-subtle" onClick={() => onAnswer(q)}>{q}</button>
                  ))}
                </div>
              )}
              <AnswerBox ask={ask} onSend={onAnswer} />
            </>
          ) : (
            <button type="button" className="btn-secondary w-full" onClick={onRestart}><RotateCcw size={14} /> Try again</button>
          )}
        </div>
      </div>
    </>
  );
}

function Collected({ schema, values }: { schema: ReturnType<typeof dataSchema>; values: Record<string, string> }) {
  const [open, setOpen] = useState(false);
  const result = structuredResult(schema, values);
  const got = schema.filter((f) => (values[f.key] ?? "").trim()).length;
  return (
    <div className="shrink-0 border-t border-line bg-subtle/60">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between px-4 py-2 text-left" aria-expanded={open}>
        <span className="metric-label">What this call hands over</span>
        <span className="font-mono text-2xs text-fg-3">{got}/{schema.length}</span>
      </button>
      {open && (
        <dl className="max-h-40 space-y-1 overflow-y-auto px-4 pb-3">
          {schema.map((f) => {
            const value = result.data[f.key];
            const said = (values[f.key] ?? "").trim() !== "";
            return (
              <div key={f.key} className="flex items-center justify-between gap-3 text-xs">
                <dt className="truncate font-mono text-fg-3">{f.key}</dt>
                <dd className={clsx("truncate text-right", said ? "text-fg" : value ? "italic text-fg-3" : f.required ? "text-amber-700 dark:text-amber-400" : "text-fg-4")}>
                  {said ? value : value ? `${value} (fallback)` : f.required ? "required" : "—"}
                </dd>
              </div>
            );
          })}
        </dl>
      )}
    </div>
  );
}
