"use client";

// Talk to the agent for real: its own voice, your microphone, the same runtime
// that takes phone calls. Or have it ring a real phone from the Lisna line
// (owner 2026-11-28) and listen in here. The step it's on lights up on the
// Workflow tab and what it saves fills in below, read from the call record.

import clsx from "clsx";
import { Mic, MicOff, Phone, PhoneOff } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { humanize } from "@outreach/core/format";
import { voiceById } from "@outreach/core/voices";
import type { Flow } from "@outreach/core/types";
import { useApp } from "@/lib/store";
import { useVoiceCall, type VoicePhase } from "@/lib/voice-call";

const LAST_NUMBER = "lisna.phone-call.to";
const readLast = () => {
  try {
    return window.localStorage.getItem(LAST_NUMBER) ?? "";
  } catch {
    return "";
  }
};
const saveLast = (v: string) => {
  try {
    window.localStorage.setItem(LAST_NUMBER, v);
  } catch {
    // Private window or blocked storage: it just isn't remembered.
  }
};

const LABEL: Record<VoicePhase, string> = {
  idle: "Ready to talk",
  connecting: "Connecting…",
  ringing: "Ringing…",
  waiting: "Joining…",
  listening: "Listening…",
  thinking: "Thinking…",
  speaking: "Speaking…",
  ended: "Call ended",
};
const ORB: Record<VoicePhase, string> = { idle: "idle", connecting: "idle", ringing: "listening", waiting: "listening", listening: "listening", thinking: "listening", speaking: "speaking", ended: "ended" };

export function LiveVoice({ flow, contactId, onActiveStep, onSaved }: { flow: Flow; contactId: string | null; onActiveStep: (id: string | null) => void; onSaved: (values: Record<string, string>) => void }) {
  const v = useVoiceCall(flow.id);
  const app = useApp();
  const line = app.numbers.find((n) => n.id === flow.numberId && n.shared);
  const [to, setTo] = useState("");
  useEffect(() => setTo(readLast()), []);
  const callPhone = () => {
    if (!to.trim()) return;
    saveLast(to.trim());
    void v.start(contactId, to.trim());
  };
  const voice = voiceById(flow.agent.voiceId);
  const inCall = v.phase !== "idle" && v.phase !== "ended";
  const call = v.call;

  useEffect(() => {
    onActiveStep(v.phase === "idle" ? null : call?.path?.[call.path.length - 1] ?? null);
  }, [call?.path, v.phase, onActiveStep]);
  useEffect(() => {
    onSaved(call?.saved ?? {});
  }, [call?.saved, onSaved]);

  const lastAgent = [...v.captions].reverse().find((c) => c.who === "agent");
  const lastYou = [...v.captions].reverse().find((c) => c.who === "you");
  const youAfterAgent = lastYou && v.captions.lastIndexOf(lastYou) > (lastAgent ? v.captions.lastIndexOf(lastAgent) : -1);
  const filed = v.phase === "ended" && call && !call.live;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div ref={v.audioRef} hidden />
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-6 py-8 text-center">
        <div className="orb-wrap h-36 w-36 sm:h-40 sm:w-40" data-phase={v.muted && inCall ? "muted" : ORB[v.phase]}>
          <div className="orb" />
        </div>
        <div className="mt-6 text-base font-semibold">{flow.agent.name}</div>
        <div className="text-xs text-fg-3">
          {voice.accent} · {voice.tone}
        </div>
        <div className={clsx("mt-3 text-sm font-medium", v.phase === "listening" ? "text-accent" : "text-fg-2")} aria-live="polite">
          {v.phase === "ended" ? (filed ? <>Call ended · {humanize(call.outcome || "done")}</> : "Wrapping up…") : v.muted && inCall ? "You're muted" : LABEL[v.phase]}
        </div>

        {inCall && (lastAgent || lastYou) && (
          <div className="mt-4 min-h-[72px] w-full space-y-2">
            {lastAgent && <p className="text-[15px] leading-relaxed text-fg">{lastAgent.text}</p>}
            {youAfterAgent && lastYou && <p className="text-sm text-fg-3">{v.phoneTo ? "They" : "You"}: {lastYou.text}</p>}
          </div>
        )}

        {filed && call.summary && <p className="mt-4 text-sm text-fg-2">{call.summary}</p>}

        <div className="mt-6 flex items-center gap-3">
          {inCall ? (
            <>
              {!v.phoneTo && <button type="button" onClick={() => void v.toggleMute()} className={clsx("flex h-12 w-12 items-center justify-center rounded-full border transition-colors", v.muted ? "border-fg bg-fg text-background" : "border-line bg-surface hover:bg-subtle")} aria-label={v.muted ? "Unmute" : "Mute"} aria-pressed={v.muted}>
                {v.muted ? <MicOff size={18} /> : <Mic size={18} />}
              </button>}
              <button type="button" onClick={() => void v.end()} className="flex h-12 items-center gap-2 rounded-full bg-rose-600 px-5 text-sm font-medium text-white transition-colors hover:bg-rose-700">
                <PhoneOff size={17} /> End call
              </button>
            </>
          ) : (
            <button type="button" onClick={() => void v.start(contactId)} className="flex h-12 items-center gap-2 rounded-full bg-fg px-6 text-sm font-medium text-background transition-opacity hover:opacity-90">
              <Phone size={17} /> {v.phase === "ended" ? "Call again" : `Talk to ${flow.agent.name}`}
            </button>
          )}
        </div>

        {v.phoneTo && inCall && <p className="mt-3 font-mono text-xs text-fg-3">Calling {v.phoneTo} from the Lisna line · you&apos;re listening in</p>}

        {!inCall && (
          <div className="mt-6 w-full border-t border-line pt-4 text-left">
            <div className="mb-1.5 text-xs font-medium text-fg-2">Or call a phone</div>
            {line ? (
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  callPhone();
                }}
              >
                <input className="field h-10 min-w-0 flex-1 font-mono" type="tel" inputMode="tel" autoComplete="tel" value={to} onChange={(e) => setTo(e.target.value)} placeholder="+1 416 555 0123" aria-label="Phone number to call" />
                <button type="submit" className="btn-secondary h-10 shrink-0" disabled={!to.trim()}>
                  <Phone size={15} /> Call
                </button>
              </form>
            ) : (
              <p className="text-xs text-fg-3">To ring a real phone, give {flow.agent.name} the Lisna line in Config → Number.</p>
            )}
            {line && <p className="mt-1.5 text-xs text-fg-3">{flow.agent.name} calls from {line.display}; you listen in here. Include the country code.</p>}
          </div>
        )}

        {v.error && (
          <p className="mt-4 text-sm text-rose-700 dark:text-rose-400" role="alert">
            {v.error}
          </p>
        )}
        {filed && (
          <Link href={`/calls?open=${call.id}`} className="mt-4 text-sm text-fg-2 underline-offset-4 hover:text-fg hover:underline">
            Open the full call
          </Link>
        )}
      </div>
      <p className="px-6 pb-3 text-center text-xs text-fg-3">A real call with {flow.agent.name}&apos;s voice. Test calls are kept in Calls and left out of your stats.</p>
    </div>
  );
}
