"use client";

// Ask before something that can't easily be undone (audit B26): a small popover
// on the button itself, never a page-blocking dialog. `skip` runs it straight
// away when there's nothing to lose; `blocked` explains why it can't happen.

import { useState, type ReactElement, type ReactNode } from "react";
import { Popover } from "./popover";

export function Confirm({
  trigger,
  title,
  body,
  action,
  onConfirm,
  skip = false,
  danger = false,
  blocked,
}: {
  trigger: ReactElement;
  title: string;
  body?: ReactNode;
  action: string;
  onConfirm: () => void;
  skip?: boolean;
  danger?: boolean;
  blocked?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  if (skip && !blocked) return <span onClickCapture={(e) => { if ((e.target as HTMLElement).closest("button:not([disabled])")) onConfirm(); }}>{trigger}</span>;
  return (
    <Popover open={open} onOpenChange={setOpen} className="w-72" align="end" trigger={trigger}>
      <div className="text-sm font-medium">{blocked ? "Not possible right now" : title}</div>
      <div className="mt-1 text-xs leading-relaxed text-fg-3">{blocked ?? body}</div>
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" className="btn-ghost h-8 px-3 text-sm" onClick={() => setOpen(false)}>{blocked ? "OK" : "Cancel"}</button>
        {!blocked && (
          <button
            type="button"
            className={danger ? "h-8 rounded-lg bg-rose-600 px-3 text-sm font-medium text-white hover:bg-rose-700" : "btn-primary h-8 px-3 text-sm"}
            onClick={() => {
              setOpen(false);
              onConfirm();
            }}
          >
            {action}
          </button>
        )}
      </div>
    </Popover>
  );
}
