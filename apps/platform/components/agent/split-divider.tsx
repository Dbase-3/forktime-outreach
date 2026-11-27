"use client";

// The draggable line between the agent's setup (left) and Workflow / Preview
// (right), from tablet width up (owner 2026-11-27). Drag it, use the arrow keys
// when it's focused, or double-click to go back to 60/40. The width is kept per
// browser. Phones show one pane at a time, so it's hidden there.

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

const KEY = "ft.agentSplit";
const DEFAULT = 60;
const MIN = 35;
const MAX = 75;
const clamp = (n: number) => Math.min(MAX, Math.max(MIN, Math.round(n * 10) / 10));

/** The left pane's width in percent, remembered on this browser (read after mount so the first paint matches the server). */
export function useSplit(): [number, (pct: number) => void] {
  const [pct, setPct] = useState(DEFAULT);
  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(KEY));
      if (saved) setPct(clamp(saved));
    } catch {
      /* private window: the default is fine */
    }
  }, []);
  const set = useCallback((next: number) => {
    const v = clamp(next);
    setPct(v);
    try {
      localStorage.setItem(KEY, String(v));
    } catch {
      /* not kept: fine */
    }
  }, []);
  return [pct, set];
}

export function SplitDivider({ container, pct, onChange }: { container: RefObject<HTMLElement>; pct: number; onChange: (pct: number) => void }) {
  const [dragging, setDragging] = useState(false);
  const raf = useRef(0);

  const toPct = (clientX: number) => {
    const box = container.current?.getBoundingClientRect();
    return box && box.width > 0 ? ((clientX - box.left) / box.width) * 100 : pct;
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the setup and preview panes"
      aria-valuemin={MIN}
      aria-valuemax={MAX}
      aria-valuenow={Math.round(pct)}
      tabIndex={0}
      className="group relative z-10 -mx-1 hidden w-2 shrink-0 cursor-col-resize touch-none select-none outline-none md:block"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragging(true);
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
      }}
      onPointerMove={(e) => {
        if (!dragging) return;
        const x = e.clientX;
        cancelAnimationFrame(raf.current);
        raf.current = requestAnimationFrame(() => onChange(toPct(x)));
      }}
      onPointerUp={(e) => {
        if (!dragging) return;
        e.currentTarget.releasePointerCapture(e.pointerId);
        setDragging(false);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }}
      onLostPointerCapture={() => {
        setDragging(false);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }}
      onDoubleClick={() => onChange(DEFAULT)}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          e.preventDefault();
          onChange(pct + (e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 5 : 2));
        } else if (e.key === "Home") onChange(MIN);
        else if (e.key === "End") onChange(MAX);
      }}
    >
      {/* The hairline, which thickens and takes the accent while hovered, focused or dragged. */}
      <div
        className={
          "absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-line transition-[width,background-color] duration-150 group-hover:w-[3px] group-hover:bg-accent/60 group-focus-visible:w-[3px] group-focus-visible:bg-accent " +
          (dragging ? "w-[3px] bg-accent" : "")
        }
      />
      {/* A small grip in the middle so it reads as draggable. */}
      <div className="absolute left-1/2 top-1/2 flex h-8 w-1.5 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center gap-[3px] rounded-full border border-line bg-surface opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
        <span className="h-0.5 w-0.5 rounded-full bg-fg-4" />
        <span className="h-0.5 w-0.5 rounded-full bg-fg-4" />
        <span className="h-0.5 w-0.5 rounded-full bg-fg-4" />
      </div>
    </div>
  );
}
