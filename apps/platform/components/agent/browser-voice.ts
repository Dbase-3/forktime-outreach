"use client";

// The preview talks and listens with the browser's own speech (no backend yet).
// Real calls use the agent's chosen voice; this is only for trying the flow.

import type { AgentVoice } from "@/lib/types";
import { voiceById } from "@/lib/voices";

const ACCENT_LANG: Record<string, string> = { American: "en-US", Australian: "en-AU", British: "en-GB", Canadian: "en-CA", Indian: "en-IN" };
const LANGUAGE_LANG: Record<string, string> = { Spanish: "es-ES", French: "fr-FR", German: "de-DE", Italian: "it-IT", Portuguese: "pt-BR", Hindi: "hi-IN", Arabic: "ar-SA", Mandarin: "zh-CN" };

export function langFor(agent: AgentVoice): string {
  if (agent.language !== "English") return LANGUAGE_LANG[agent.language] ?? "en-US";
  return ACCENT_LANG[voiceById(agent.voiceId).accent] ?? "en-US";
}

export function canSpeak(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/** The nicest browser voice for a language: an exact match first, "natural"/"enhanced" ones preferred. */
function pickVoice(lang: string): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices();
  const base = lang.split("-")[0];
  const rank = (v: SpeechSynthesisVoice) => (v.lang === lang ? 0 : v.lang.startsWith(base) ? 2 : 9) - (/natural|enhanced|premium|neural|google/i.test(v.name) ? 1 : 0);
  return voices.filter((v) => v.lang.startsWith(base)).sort((a, b) => rank(a) - rank(b))[0];
}

/** Says the lines one after another, then calls `done` once. Returns a cancel. */
export function speakLines(lines: string[], opts: { lang: string; rate: number }, done: () => void): () => void {
  if (lines.length === 0) {
    const t = setTimeout(done, 0);
    return () => clearTimeout(t);
  }
  if (!canSpeak()) {
    // No speech: give people time to read the caption instead.
    const t = setTimeout(done, Math.min(6000, 700 + lines.join(" ").length * 45));
    return () => clearTimeout(t);
  }
  const synth = window.speechSynthesis;
  synth.cancel();
  const voice = pickVoice(opts.lang);
  let finished = false;
  // Browsers sometimes never fire "end" (no audio device, or Chrome dropping a
  // collected utterance), so a watchdog moves on after a generous reading time.
  const words = lines.join(" ").split(/\s+/).length;
  const watchdog = setTimeout(() => finish(), 2500 + (words * 520) / Math.max(0.5, opts.rate));
  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(watchdog);
    speaking.length = 0;
    done();
  };
  lines.forEach((text, i) => {
    const u = new SpeechSynthesisUtterance(text.replace(/\{\w+\}/g, ""));
    u.lang = opts.lang;
    if (voice) u.voice = voice;
    u.rate = opts.rate;
    if (i === lines.length - 1) {
      u.onend = finish;
      u.onerror = finish;
    }
    speaking.push(u);
    synth.speak(u);
  });
  return () => {
    finished = true;
    clearTimeout(watchdog);
    speaking.length = 0;
    synth.cancel();
  };
}

/** Held so Chrome doesn't garbage-collect an utterance mid-sentence and lose its "end" event. */
const speaking: SpeechSynthesisUtterance[] = [];

// ---- Listening ----

interface RecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}
export interface Recognizer {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<RecognitionResult> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}

export function recognizerCtor(): (new () => Recognizer) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognizer; webkitSpeechRecognition?: new () => Recognizer };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}
