"use client";

// Who speaks: a name, a voice, a personality, speed and language. That's all
// the tuning a customer gets; the models behind it are ours to choose.

import clsx from "clsx";
import { Check } from "lucide-react";
import { LANGUAGES, PERSONALITIES, VOICES } from "@/lib/voices";
import type { AgentVoice } from "@/lib/types";
import { Avatar, Field } from "../ui";

export function VoicePanel({ agent, onChange }: { agent: AgentVoice; onChange: (patch: Partial<AgentVoice>) => void }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
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
      </div>

      <div>
        <span className="label">Voice</span>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {VOICES.map((voice) => {
            const selected = agent.voiceId === voice.id;
            return (
              <button
                key={voice.id}
                type="button"
                onClick={() => onChange({ voiceId: voice.id })}
                className={clsx("flex items-center gap-3 rounded-xl border p-3 text-left transition", selected ? "border-accent bg-accent/[0.06] ring-[3px] ring-accent/15" : "border-line bg-surface hover:border-line-strong")}
              >
                <Avatar name={voice.name} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">{voice.name}</span>
                  <span className="block truncate text-xs text-fg-3">{voice.accent} · {voice.tone}</span>
                </span>
                {selected && <Check size={16} className="text-accent" />}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <span className="label">Personality</span>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {PERSONALITIES.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onChange({ personality: p.id })}
              className={clsx("rounded-xl border p-3 text-left transition", agent.personality === p.id ? "border-accent bg-accent/[0.06]" : "border-line bg-surface hover:border-line-strong")}
            >
              <span className="block text-sm font-semibold">{p.label}</span>
              <span className="mt-0.5 block text-xs text-fg-3">{p.hint}</span>
            </button>
          ))}
        </div>
      </div>

      <div>
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
