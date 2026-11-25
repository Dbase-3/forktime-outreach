"use client";

// Who speaks: a name, a voice, a personality, speed and language. That's all
// the tuning a customer gets; the models behind it are ours to choose.
// Compact dropdowns (owner 2026-11-26: "voices need to be a dropdown").

import { LANGUAGES, PERSONALITIES, VOICES } from "@/lib/voices";
import type { AgentVoice, Personality } from "@/lib/types";
import { Field } from "../ui";

export function VoicePanel({ agent, onChange }: { agent: AgentVoice; onChange: (patch: Partial<AgentVoice>) => void }) {
  const personality = PERSONALITIES.find((p) => p.id === agent.personality);
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Voice">
          <select className="field" value={agent.voiceId} onChange={(e) => onChange({ voiceId: e.target.value })}>
            {VOICES.map((voice) => (
              <option key={voice.id} value={voice.id}>{voice.name} · {voice.accent}, {voice.tone.toLowerCase()}</option>
            ))}
          </select>
        </Field>
        <Field label="Agent's name" hint="What it calls itself on the call.">
          <input className="field" value={agent.name} onChange={(e) => onChange({ name: e.target.value })} />
        </Field>
        <Field label="Language">
          <select className="field" value={agent.language} onChange={(e) => onChange({ language: e.target.value })}>
            {LANGUAGES.map((language) => (
              <option key={language}>{language}</option>
            ))}
          </select>
        </Field>
        <Field label="Personality" hint={personality?.hint}>
          <select className="field" value={agent.personality} onChange={(e) => onChange({ personality: e.target.value as Personality })}>
            {PERSONALITIES.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </Field>
      </div>

      <div className="sm:w-1/2 sm:pr-2">
        <div className="flex items-center justify-between">
          <span className="label">Speaking speed</span>
          <span className="text-sm font-medium tabular-nums text-fg-2">{agent.speed.toFixed(2)}×</span>
        </div>
        <input
          type="range"
          min={0.9}
          max={1.2}
          step={0.05}
          value={agent.speed}
          onChange={(e) => onChange({ speed: Number(e.target.value) })}
          className="w-full accent-[rgb(var(--accent))]"
          aria-label="Speaking speed"
        />
        <div className="flex justify-between text-xs text-fg-4">
          <span>Slower</span>
          <span>Normal</span>
          <span>Faster</span>
        </div>
      </div>
    </div>
  );
}
