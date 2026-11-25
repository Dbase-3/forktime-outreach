"use client";

// Try the agent, ElevenLabs-style: voice first (an orb, a call button, mute),
// or switch to chat. Both drive the same run of the workflow, so the step the
// call is on lights up on the Workflow tab, and the record it will hand over
// fills in as you answer. Voice uses the browser's speech for now.

import clsx from "clsx";
import { Keyboard, MessageSquareText, Mic, MicOff, Phone, PhoneOff, RotateCcw, Send } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { dataSchema, structuredResult } from "@/lib/agent-data";
import { humanize } from "@/lib/format";
import { answerPractice, startPractice, type PracticeState } from "@/lib/practice";
import { readAnswer } from "@/lib/spoken";
import { voiceById } from "@/lib/voices";
import type { Contact, Flow } from "@/lib/types";
import { Badge, Segmented } from "../ui";
import { langFor, recognizerCtor, speakLines, type Recognizer } from "./browser-voice";

type Mode = "voice" | "chat";
type Phase = "idle" | "speaking" | "listening" | "muted" | "ended";

const PHASE_LABEL: Record<Phase, string> = { idle: "Ready to talk", speaking: "Speaking…", listening: "Listening…", muted: "You're muted", ended: "Call ended" };

export function PreviewPanel({ flow, business, contacts, onActiveStep }: { flow: Flow; business: string; contacts: Contact[]; onActiveStep: (id: string | null) => void }) {
  const [mode, setMode] = useState<Mode>("voice");
  const [contactId, setContactId] = useState(contacts[0]?.id ?? "");
  const contact = contacts.find((c) => c.id === contactId);
  const begin = useMemo(() => () => startPractice(flow, { agentName: flow.agent.name, business, contactFields: { first_name: contact?.name.split(" ")[0] ?? "", ...(contact?.fields ?? {}) } }), [flow, business, contact]);
  const [state, setState] = useState<PracticeState>(begin);
  const stateRef = useRef(state);
  stateRef.current = state;

  // ---- Voice call ----
  const [phase, setPhase] = useState<Phase>("idle");
  const [heard, setHeard] = useState("");
  const [muted, setMuted] = useState(false);
  const [micProblem, setMicProblem] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const turn = useRef(0); // bumps on every new turn or hang-up, so stale callbacks do nothing
  const rec = useRef<Recognizer | null>(null);
  const stopSpeech = useRef<() => void>(() => {});
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const onCall = useRef(false); // a voice call is running: answers get spoken replies
  const lang = langFor(flow.agent);
  const rate = flow.agent.speed;

  const stopListening = () => {
    const r = rec.current;
    rec.current = null;
    if (r) {
      r.onend = null;
      r.onresult = null;
      r.onerror = null;
      r.abort();
    }
  };

  const hangUp = useCallback((next: Phase) => {
    turn.current += 1;
    onCall.current = false;
    stopSpeech.current();
    stopListening();
    setHeard("");
    setPhase(next);
  }, []);

  const listen = (token: number) => {
    if (token !== turn.current) return;
    if (mutedRef.current) {
      setPhase("muted");
      return;
    }
    setPhase("listening");
    const Ctor = recognizerCtor();
    if (!Ctor) {
      setMicProblem("This browser can't listen. Tap an answer or type it.");
      return;
    }
    const r = new Ctor();
    rec.current = r;
    r.lang = lang;
    r.interimResults = true;
    r.continuous = false;
    let final = "";
    r.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) final += res[0].transcript;
        else interim += res[0].transcript;
      }
      setHeard(final || interim);
    };
    r.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return; // silence: onend listens again
      rec.current = null; // a real problem: stop, don't loop
      setMicProblem(
        e.error === "not-allowed" || e.error === "service-not-allowed"
          ? "The microphone is blocked. Allow it in the address bar, or type your answer."
          : e.error === "audio-capture"
            ? "No microphone found. Tap an answer or type it."
            : "Couldn't hear you just now. Tap an answer or type it.",
      );
    };
    r.onend = () => {
      if (rec.current !== r) return;
      rec.current = null;
      if (final.trim()) answer(final);
      else if (token === turn.current && !mutedRef.current) setTimeout(() => listen(token), 150); // silence: keep listening
    };
    try {
      r.start();
    } catch {
      setMicProblem("Couldn't start the microphone. Type your answer instead.");
    }
  };

  const speakFrom = (s: PracticeState, from: number) => {
    const token = ++turn.current;
    const lines = s.lines.slice(from).filter((l) => l.who === "agent").map((l) => l.text);
    setPhase("speaking");
    setHeard("");
    stopSpeech.current = speakLines(lines, { lang, rate }, () => {
      if (token !== turn.current) return;
      if (s.outcome) {
        onCall.current = false;
        setPhase("ended");
      } else listen(token);
    });
  };

  const startCall = () => {
    const s = begin();
    setState(s);
    setMicProblem(null);
    setTyping(false);
    onCall.current = true;
    speakFrom(s, 0);
  };

  /** One answer from the caller, spoken, tapped or typed. */
  function answer(said: string) {
    const cur = stateRef.current;
    const ask = cur.waitingFor;
    if (!ask || !said.trim()) return;
    stopListening();
    const next = answerPractice(cur, said, readAnswer(ask, said));
    setState(next);
    if (onCall.current) speakFrom(next, cur.lines.length + 1);
  }

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    mutedRef.current = next;
    if (next) {
      stopListening();
      if (phase === "listening") setPhase("muted");
    } else if (phase === "muted") listen(turn.current);
  };

  // A changed workflow or contact starts over, so the preview always matches the screen.
  useEffect(() => {
    hangUp("idle");
    setState(begin());
  }, [begin, hangUp]);
  useEffect(() => {
    return () => {
      turn.current += 1;
      onCall.current = false;
      stopSpeech.current();
      stopListening();
    };
  }, []);
  useEffect(() => {
    onActiveStep(mode === "voice" && phase === "idle" ? null : state.currentId);
  }, [state.currentId, mode, phase, onActiveStep]);
  useEffect(() => {
    return () => {
      onActiveStep(null);
    };
  }, [onActiveStep]);

  const switchMode = (next: Mode) => {
    if (next === mode) return;
    hangUp("idle");
    setMode(next);
  };

  const ask = state.waitingFor;
  const quick = ask?.answerType === "yesno" ? ["Yes", "No"] : ask?.answerType === "choice" ? ask.choices ?? [] : [];
  const schema = dataSchema(flow);
  const voice = voiceById(flow.agent.voiceId);
  const inCall = phase !== "idle" && phase !== "ended";

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 space-y-2 border-b border-line px-4 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <Segmented<Mode> value={mode} onChange={switchMode} options={[{ value: "voice", label: "Voice" }, { value: "chat", label: "Chat" }]} />
          <button type="button" className="btn-ghost h-8 shrink-0 px-2 text-xs" onClick={() => (mode === "voice" ? (inCall ? startCall() : hangUp("idle")) : setState(begin()))}>
            <RotateCcw size={13} /> Restart
          </button>
        </div>
        <label className="flex items-center gap-2">
          <span className="shrink-0 text-xs text-fg-3">{flow.direction === "inbound" ? "Caller" : "Calling"}</span>
          <select className="field h-8 min-w-0 flex-1 py-0 text-sm" value={contactId} onChange={(e) => setContactId(e.target.value)} aria-label="Preview as contact">
            {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}{c.phone ? ` · ${c.phone}` : ""}</option>)}
          </select>
        </label>
      </div>

      {mode === "voice" ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-6 py-8 text-center">
            <div className="orb-wrap h-36 w-36 sm:h-40 sm:w-40" data-phase={phase}>
              <div className="orb" />
            </div>
            <div className="mt-6 text-base font-semibold">{flow.agent.name}</div>
            <div className="text-xs text-fg-3">{voice.accent} · {voice.tone}</div>
            <div className={clsx("mt-3 text-sm font-medium", phase === "listening" ? "text-accent" : "text-fg-2")} aria-live="polite">
              {phase === "ended" && state.outcome ? <>Call ended · {humanize(state.outcome)}</> : PHASE_LABEL[phase]}
            </div>

            {phase !== "idle" && (
              <div className="mt-4 min-h-[72px] w-full space-y-2">
                <Caption state={state} heard={heard} />
              </div>
            )}

            <div className="mt-6 flex items-center gap-3">
              {inCall ? (
                <>
                  <button type="button" onClick={toggleMute} className={clsx("flex h-12 w-12 items-center justify-center rounded-full border transition-colors", muted ? "border-fg bg-fg text-background" : "border-line bg-surface hover:bg-subtle")} aria-label={muted ? "Unmute" : "Mute"} aria-pressed={muted}>
                    {muted ? <MicOff size={18} /> : <Mic size={18} />}
                  </button>
                  <button type="button" onClick={() => hangUp("ended")} className="flex h-12 items-center gap-2 rounded-full bg-rose-600 px-5 text-sm font-medium text-white transition-colors hover:bg-rose-700">
                    <PhoneOff size={17} /> End call
                  </button>
                  <button type="button" onClick={() => setTyping((t) => !t)} className={clsx("flex h-12 w-12 items-center justify-center rounded-full border transition-colors", typing ? "border-fg bg-fg text-background" : "border-line bg-surface hover:bg-subtle")} aria-label="Type instead" aria-pressed={typing}>
                    <Keyboard size={18} />
                  </button>
                </>
              ) : (
                <button type="button" onClick={startCall} className="flex h-12 items-center gap-2 rounded-full bg-fg px-6 text-sm font-medium text-background transition-opacity hover:opacity-90">
                  <Phone size={17} /> {phase === "ended" ? "Call again" : `Talk to ${flow.agent.name}`}
                </button>
              )}
            </div>

            {inCall && ask && (phase === "listening" || phase === "muted") && (
              <div className="mt-5 w-full space-y-2">
                {micProblem && <p className="text-xs text-amber-700 dark:text-amber-400">{micProblem}</p>}
                {quick.length > 0 && (
                  <div className="flex flex-wrap justify-center gap-1.5">
                    {quick.map((q) => (
                      <button key={q} type="button" className="h-8 rounded-full border border-line px-3 text-sm hover:bg-subtle" onClick={() => answer(q)}>{q}</button>
                    ))}
                  </div>
                )}
                {(typing || micProblem) && <AnswerBox ask={ask} onSend={answer} autoFocus />}
              </div>
            )}

            {phase === "idle" && (
              <button type="button" onClick={() => switchMode("chat")} className="mt-4 flex items-center gap-1.5 text-xs text-fg-3 hover:text-fg">
                <MessageSquareText size={13} /> Prefer typing? Switch to chat
              </button>
            )}
          </div>
          <p className="px-6 pb-3 text-center text-2xs text-fg-4">The preview speaks with your browser&apos;s voice. Calls use {flow.agent.name}&apos;s voice.</p>
        </div>
      ) : (
        <ChatView state={state} onAnswer={answer} onRestart={() => setState(begin())} />
      )}

      {schema.length > 0 && <Collected schema={schema} state={state} />}
    </div>
  );
}

function Caption({ state, heard }: { state: PracticeState; heard: string }) {
  const lines = state.lines;
  const agentAt = lines.findLastIndex((l) => l.who === "agent");
  const callerAt = lines.findLastIndex((l) => l.who === "caller");
  const actions = lines.slice(Math.max(0, callerAt)).filter((l) => l.who === "system");
  const lastAgent = agentAt >= 0 ? lines[agentAt] : null;
  const showCaller = heard || (callerAt > agentAt ? lines[callerAt].text : "");
  return (
    <>
      {actions.length > 0 && (
        <div className="flex flex-wrap justify-center gap-1.5">
          {actions.map((a, i) => (
            <span key={i} className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-xs text-emerald-800 dark:text-emerald-300">{a.text}</span>
          ))}
        </div>
      )}
      {lastAgent && <p className="text-[15px] leading-relaxed text-fg">{lastAgent.text}</p>}
      {showCaller && <p className="text-sm text-fg-3">You: {showCaller}</p>}
    </>
  );
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

function Collected({ schema, state }: { schema: ReturnType<typeof dataSchema>; state: PracticeState }) {
  const [open, setOpen] = useState(false);
  const values = state.values;
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
