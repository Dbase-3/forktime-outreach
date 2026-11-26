"use client";

// Six boxes for the emailed code. One real input sits over them (invisible),
// so typing, pasting and the phone's "from Mail" suggestion all just work.

import { useState } from "react";

export function CodeInput({ value, onChange, disabled, invalid }: { value: string; onChange: (v: string) => void; disabled?: boolean; invalid?: boolean }) {
  const [focused, setFocused] = useState(false);
  return (
    <div className="relative">
      <div className="grid grid-cols-6 gap-2" aria-hidden>
        {Array.from({ length: 6 }, (_, i) => {
          const current = focused && (i === value.length || (i === 5 && value.length === 6));
          return (
            <div
              key={i}
              className={`flex h-12 items-center justify-center rounded-lg border bg-surface font-mono text-xl text-fg transition-colors ${
                invalid ? "border-rose-500/60" : current ? "border-fg-3 ring-[3px] ring-fg/5" : value[i] ? "border-line-strong" : "border-line"
              }`}
            >
              {value[i] ?? (current ? <span className="h-5 w-px animate-pulse bg-fg" /> : "")}
            </div>
          );
        })}
      </div>
      <input
        className="absolute inset-0 h-full w-full cursor-text opacity-0"
        inputMode="numeric"
        autoComplete="one-time-code"
        aria-label="6-digit code"
        maxLength={6}
        value={value}
        disabled={disabled}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
        autoFocus
      />
    </div>
  );
}
