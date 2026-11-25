"use client";

// Test the agent right beside its workflow: play the caller, watch the step it's
// on light up, and see the record the call will hand over fill in.

import clsx from "clsx";
import { RotateCcw, Send } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { dataSchema, structuredResult } from "@/lib/agent-data";
import { humanize } from "@/lib/format";
import { answerPractice, startPractice, type PracticeState } from "@/lib/practice";
import type { Contact, Flow } from "@/lib/types";
import { Badge } from "../ui";

export function TestPanel({ flow, business, contacts, onActiveStep }: { flow: Flow; business: string; contacts: Contact[]; onActiveStep: (id: string | null) => void }) {
  const [contactId, setContactId] = useState(contacts[0]?.id ?? "");
  const contact = contacts.find((c) => c.id === contactId);
  const begin = useMemo(() => () => startPractice(flow, { agentName: flow.agent.name, business, contactFields: contact?.fields ?? {} }), [flow, business, contact]);
  const [state, setState] = useState<PracticeState>(begin);
  const [text, setText] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const schema = dataSchema(flow);
  const result = structuredResult(schema, state.values);

  // Restart whenever the workflow or the contact changes, so the test always matches what's on screen.
  useEffect(() => setState(begin()), [begin]);
  useEffect(() => onActiveStep(state.currentId), [state.currentId, onActiveStep]);
  useEffect(() => () => onActiveStep(null), [onActiveStep]);
  useEffect(() => end.current?.scrollIntoView({ block: "end" }), [state.lines.length]);

  const ask = state.waitingFor;
  const quick = ask?.answerType === "yesno" ? ["Yes", "No"] : ask?.answerType === "choice" ? ask.choices ?? [] : [];
  const send = (value: string) => {
    if (!value.trim()) return;
    setState((s) => answerPractice(s, value));
    setText("");
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <span className="text-xs text-fg-3">Calling</span>
        <select className="field h-7 w-auto min-w-0 flex-1 py-0 text-xs" value={contactId} onChange={(e) => setContactId(e.target.value)} aria-label="Test as contact">
          {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button type="button" className="btn-ghost h-7 px-2 text-xs" onClick={() => setState(begin())}><RotateCcw size={13} /> Restart</button>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
        {state.lines.map((line, i) =>
          line.who === "system" ? (
            <div key={i} className="flex justify-center">
              <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-xs text-emerald-800 dark:text-emerald-300">{line.text}</span>
            </div>
          ) : (
            <div key={i} className={clsx("flex", line.who === "caller" && "justify-end")}>
              <div className={clsx("max-w-[88%] rounded-2xl px-3 py-1.5 text-sm leading-snug", line.who === "agent" ? "rounded-tl-md bg-muted" : "rounded-tr-md bg-fg text-background")}>{line.text}</div>
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

      <Collected schema={schema} result={result} values={state.values} />

      <div className="border-t border-line p-3">
        {ask ? (
          <>
            {quick.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {quick.map((q) => (
                  <button key={q} type="button" className="h-7 rounded-full border border-line px-2.5 text-xs hover:bg-subtle" onClick={() => send(q)}>{q}</button>
                ))}
              </div>
            )}
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); send(text); }}>
              <input className="field h-9" value={text} onChange={(e) => setText(e.target.value)} placeholder="Answer as the caller…" type={ask.answerType === "date" ? "date" : ask.answerType === "number" ? "number" : "text"} />
              <button type="submit" className="btn-primary h-9 px-3" aria-label="Send"><Send size={15} /></button>
            </form>
          </>
        ) : (
          <button type="button" className="btn-secondary w-full" onClick={() => setState(begin())}><RotateCcw size={14} /> Test again</button>
        )}
      </div>
    </div>
  );
}

function Collected({ schema, result, values }: { schema: ReturnType<typeof dataSchema>; result: ReturnType<typeof structuredResult>; values: Record<string, string> }) {
  const [open, setOpen] = useState(true);
  if (schema.length === 0) return null;
  const got = schema.filter((f) => (values[f.key] ?? "").trim()).length;
  return (
    <div className="border-t border-line bg-subtle/60">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between px-4 py-2 text-left">
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
