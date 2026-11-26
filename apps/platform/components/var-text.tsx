"use client";

// A text box for anything the agent says or is told, with "Insert variable":
// a searchable list of what this line can use (the call's own, the contact's
// fields, earlier answers). Picking one puts {key} at the cursor. Variables
// nothing fills in are flagged under the box, so a typo is caught before a call.

import { AlertTriangle, Braces, Search } from "lucide-react";
import { useRef, useState, type FocusEventHandler } from "react";
import { insertVar, unknownVars, type VarGroup } from "@outreach/core/variables";
import { Popover } from "./popover";

export function VarText({
  value,
  onChange,
  groups,
  className = "field min-h-20",
  placeholder,
  autoFocus,
  disabled,
  onBlur,
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (next: string) => void;
  groups: VarGroup[];
  className?: string;
  placeholder?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  onBlur?: FocusEventHandler<HTMLTextAreaElement>;
  "aria-label"?: string;
}) {
  const box = useRef<HTMLTextAreaElement>(null);
  const caret = useRef<{ start: number; end: number }>({ start: value.length, end: value.length });
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const unknown = unknownVars(value, groups);

  const remember = () => {
    const el = box.current;
    if (el) caret.current = { start: el.selectionStart, end: el.selectionEnd };
  };
  const pick = (key: string) => {
    const { start, end } = caret.current;
    const next = insertVar(value, Math.min(start, value.length), Math.min(end, value.length), key);
    onChange(next.text);
    setOpen(false);
    setQuery("");
    requestAnimationFrame(() => {
      const el = box.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(next.caret, next.caret);
      caret.current = { start: next.caret, end: next.caret };
    });
  };

  const q = query.trim().toLowerCase();
  const shown = groups
    .map((g) => ({ ...g, vars: g.vars.filter((v) => !q || v.key.includes(q) || v.label.toLowerCase().includes(q)) }))
    .filter((g) => g.vars.length > 0);

  return (
    <div>
      <textarea
        ref={box}
        className={className}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          caret.current = { start: e.target.selectionStart, end: e.target.selectionEnd };
        }}
        onSelect={remember}
        onKeyUp={remember}
        onClick={remember}
        onBlur={(e) => {
          remember();
          onBlur?.(e);
        }}
        placeholder={placeholder}
        autoFocus={autoFocus}
        disabled={disabled}
        aria-label={ariaLabel}
      />
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
        <Popover
          open={open}
          onOpenChange={(o) => {
            setOpen(o);
            if (!o) setQuery("");
          }}
          className="w-72 p-0"
          trigger={
            <button type="button" className="flex h-7 items-center gap-1.5 rounded-md px-1.5 text-xs font-medium text-fg-2 transition-colors hover:bg-subtle hover:text-fg disabled:opacity-50" disabled={disabled}>
              <Braces size={13} /> Insert variable
            </button>
          }
        >
          <div className="flex items-center gap-2 border-b border-line px-3 py-2">
            <Search size={13} className="text-fg-4" />
            <input className="h-6 w-full bg-transparent text-sm outline-none placeholder:text-fg-4" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search variables" autoFocus aria-label="Search variables" />
          </div>
          <div className="max-h-72 overflow-y-auto py-1">
            {shown.length === 0 && <p className="px-3 py-2 text-sm text-fg-3">No variable matches.</p>}
            {shown.map((g) => (
              <div key={g.title} className="py-1">
                <div className="metric-label px-3 py-1">{g.title}</div>
                {g.vars.map((v) => (
                  <button key={v.key} type="button" onClick={() => pick(v.key)} className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-sm hover:bg-muted">
                    <span className="truncate text-fg">{v.label}</span>
                    <code className="shrink-0 font-mono text-xs text-fg-3">{`{${v.key}}`}</code>
                  </button>
                ))}
              </div>
            ))}
          </div>
          <p className="border-t border-line px-3 py-2 text-xs text-fg-3">Filled in on each call; an empty one is left out. To say something else instead, add it after a bar: {"{first_name|there}"}.</p>
        </Popover>
        {unknown.length > 0 && (
          <span className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
            <AlertTriangle size={12} /> Nothing fills in {unknown.map((k) => `{${k}}`).join(", ")}. Check the spelling or add the field.
          </span>
        )}
      </div>
    </div>
  );
}
