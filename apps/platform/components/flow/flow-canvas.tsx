"use client";

// The flow as a picture on a dotted canvas: boxes, curved lines, Yes /
// Otherwise labels on decisions, and a "+" on every line to add a step there.
// Layout is automatic (lib/flow-layout.ts); people pan and zoom, never drag boxes.

import clsx from "clsx";
import { AlertCircle, Flag, Maximize2, Minus, Play, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { layoutFlow, type InsertAt, type LayoutEdge, type LayoutNode } from "@/lib/flow-layout";
import type { Step } from "@/lib/types";
import { footnote, metaOf, summarize } from "./meta";
import type { StepListContext } from "./step-list";

interface Props {
  steps: Step[];
  greeting: string;
  ctx: StepListContext;
  onAddAt: (at: InsertAt) => void;
  onEditGreeting: () => void;
}

interface View {
  x: number;
  y: number;
  z: number;
}

const MIN_Z = 0.35;
const MAX_Z = 1.6;

export function FlowCanvas({ steps, greeting, ctx, onAddAt, onEditGreeting }: Props) {
  const layout = useMemo(() => layoutFlow(steps), [steps]);
  const box = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ x: 0, y: 40, z: 1 });
  const drag = useRef<{ px: number; py: number; vx: number; vy: number } | null>(null);
  const fitted = useRef(false);

  const fit = useCallback(() => {
    const el = box.current;
    if (!el) return;
    // Fit the width (never below 70%, never above 100%); tall flows scroll down.
    const z = Math.max(0.7, Math.min(1, (el.clientWidth - 64) / layout.width));
    setView({ z, x: (el.clientWidth - layout.width * z) / 2, y: 32 });
  }, [layout.width]);

  useEffect(() => {
    if (fitted.current) return;
    fitted.current = true;
    fit();
  }, [fit]);

  // Wheel: scroll moves the canvas; with ⌘ / Ctrl (or a pinch on a trackpad) it zooms around the pointer.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (!event.ctrlKey && !event.metaKey) {
        setView((v) => ({ ...v, x: v.x - event.deltaX, y: v.y - event.deltaY }));
        return;
      }
      const rect = el.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      setView((v) => {
        const z = Math.max(MIN_Z, Math.min(MAX_Z, v.z * Math.exp(-event.deltaY * 0.01)));
        return { z, x: px - ((px - v.x) / v.z) * z, y: py - ((py - v.y) / v.z) * z };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button")) return;
    drag.current = { px: event.clientX, py: event.clientY, vx: view.x, vy: view.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    setView((v) => ({ ...v, x: d.vx + event.clientX - d.px, y: d.vy + event.clientY - d.py }));
  };
  const zoomBy = (factor: number) => {
    const el = box.current;
    if (!el) return;
    const cx = el.clientWidth / 2;
    const cy = el.clientHeight / 2;
    setView((v) => {
      const z = Math.max(MIN_Z, Math.min(MAX_Z, v.z * factor));
      return { z, x: cx - ((cx - v.x) / v.z) * z, y: cy - ((cy - v.y) / v.z) * z };
    });
  };

  const byId = new Map(layout.nodes.map((n) => [n.id, n]));

  return (
    <div
      ref={box}
      className="relative h-[calc(100dvh-260px)] min-h-[520px] touch-none select-none overflow-hidden rounded-xl border border-line bg-surface [background-image:radial-gradient(rgb(var(--line-strong))_1px,transparent_1px)] [background-size:18px_18px]"
      style={{ backgroundPosition: `${view.x}px ${view.y}px`, cursor: drag.current ? "grabbing" : "grab" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
    >
      <div className="absolute left-0 top-0 origin-top-left" style={{ width: layout.width, height: layout.height, transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})` }}>
        <svg width={layout.width} height={layout.height} className="absolute inset-0 overflow-visible">
          <defs>
            <marker id="flow-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M1,1 L7,4 L1,7" fill="none" stroke="rgb(var(--fg-4))" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </marker>
          </defs>
          {layout.edges.map((edge, i) => {
            const a = byId.get(edge.from);
            const b = byId.get(edge.to);
            return a && b ? <path key={i} d={curve(a, b).d} fill="none" stroke="rgb(var(--line-strong))" strokeWidth="1.25" markerEnd="url(#flow-arrow)" /> : null;
          })}
        </svg>
        {layout.edges.map((edge, i) => {
          const a = byId.get(edge.from);
          const b = byId.get(edge.to);
          return a && b ? <EdgeControl key={i} edge={edge} a={a} b={b} onAdd={() => onAddAt(edge.insert)} /> : null;
        })}
        {layout.nodes.map((node) => (
          <NodeBox key={node.id} node={node} greeting={greeting} ctx={ctx} onEditGreeting={onEditGreeting} onAddAt={onAddAt} />
        ))}
      </div>

      <div className="absolute bottom-3 right-3 flex items-center gap-0.5 rounded-lg border border-line bg-surface p-0.5 shadow-pop">
        <button type="button" className="btn-icon h-7 w-7" onClick={() => zoomBy(1 / 1.2)} aria-label="Zoom out"><Minus size={14} /></button>
        <span className="w-11 text-center font-mono text-2xs tabular-nums text-fg-3">{Math.round(view.z * 100)}%</span>
        <button type="button" className="btn-icon h-7 w-7" onClick={() => zoomBy(1.2)} aria-label="Zoom in"><Plus size={14} /></button>
        <span className="mx-0.5 h-4 w-px bg-line" />
        <button type="button" className="btn-icon h-7 w-7" onClick={fit} aria-label="Fit to screen"><Maximize2 size={13} /></button>
      </div>
      <div className="pointer-events-none absolute bottom-3 left-3 hidden font-mono text-2xs text-fg-4 sm:block">Drag to move · ⌘ + scroll to zoom</div>
    </div>
  );
}

/**
 * A line from the bottom of one box to the top of the next. Short hops are a
 * soft S-curve; long ones (a short lane joining the next step) drop straight
 * down their own column first, so they never pass behind the other lane's boxes.
 */
function curve(a: LayoutNode, b: LayoutNode) {
  const x1 = a.x + a.w / 2;
  const y1 = a.y + a.h;
  const x2 = b.x + b.w / 2;
  const y2 = b.y - 2;
  const bend = 44;
  const long = y2 - y1 > 140;
  const turnY = long ? y2 - bend : y1;
  const dy = long ? bend / 2 : Math.max(24, (y2 - y1) / 2);
  const d = long
    ? `M${x1},${y1} L${x1},${turnY} C${x1},${turnY + dy} ${x2},${y2 - dy} ${x2},${y2}`
    : `M${x1},${y1} C${x1},${y1 + dy} ${x2},${y2 - dy} ${x2},${y2}`;
  /** A point along the line (0..1), for placing labels and "+" buttons. */
  const at = (t: number) => {
    if (long) return { x: x1, y: y1 + (turnY - y1) * t };
    const u = 1 - t;
    return {
      x: u * u * u * x1 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x2,
      y: u * u * u * y1 + 3 * u * u * t * (y1 + dy) + 3 * u * t * t * (y2 - dy) + t * t * t * y2,
    };
  };
  return { d, at };
}

function EdgeControl({ edge, a, b, onAdd }: { edge: LayoutEdge; a: LayoutNode; b: LayoutNode; onAdd: () => void }) {
  const { at } = curve(a, b);
  if (edge.label) {
    const p = at(0.62);
    return (
      <button
        type="button"
        onClick={onAdd}
        title={`Add a step to "${edge.label}"`}
        className="group absolute flex h-6 -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 whitespace-nowrap rounded-full border border-line bg-surface pl-2 pr-1.5 text-2xs font-medium text-fg-2 shadow-pop transition-colors hover:border-line-strong hover:text-fg"
        style={{ left: p.x, top: p.y }}
      >
        <span className={clsx("h-1.5 w-1.5 rounded-full", edge.label === "Yes" ? "bg-emerald-500" : "bg-fg-4")} />
        {edge.label}
        <Plus size={11} className="text-fg-4 group-hover:text-fg" />
      </button>
    );
  }
  const p = at(0.5);
  return (
    <button
      type="button"
      onClick={onAdd}
      aria-label="Add a step here"
      className="absolute flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-line bg-surface text-fg-4 opacity-0 transition hover:scale-110 hover:border-fg-3 hover:text-fg focus-visible:opacity-100 [div:hover>&]:opacity-60 hover:!opacity-100"
      style={{ left: p.x, top: p.y }}
    >
      <Plus size={11} strokeWidth={2.4} />
    </button>
  );
}

function NodeBox({ node, greeting, ctx, onEditGreeting, onAddAt }: { node: LayoutNode; greeting: string; ctx: StepListContext; onEditGreeting: () => void; onAddAt: (at: InsertAt) => void }) {
  const style = { left: node.x, top: node.y, width: node.w, height: node.h };
  if (node.kind === "start") {
    return (
      <button type="button" onClick={onEditGreeting} title={greeting} className="absolute flex items-center justify-center gap-2 rounded-lg border border-line bg-surface text-sm font-medium shadow-pop transition-colors hover:border-line-strong" style={style}>
        <Play size={13} className="text-emerald-500" /> Start
      </button>
    );
  }
  if (node.kind === "empty") {
    return (
      <button type="button" onClick={() => node.insert && onAddAt(node.insert)} className="absolute flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-line-strong bg-background/60 text-xs text-fg-4 transition-colors hover:border-fg-3 hover:text-fg" style={style}>
        <Plus size={12} /> Add a step
      </button>
    );
  }
  if (node.kind === "end" || !node.step) {
    return (
      <div className="absolute flex items-center justify-center gap-2 rounded-lg border border-line bg-subtle text-sm text-fg-3" style={style}>
        <Flag size={13} /> End
      </div>
    );
  }
  const step = node.step;
  const meta = metaOf(step);
  const Icon = meta.icon;
  const note = footnote(step);
  const hasIssue = ctx.issueIds.has(step.id);
  return (
    <button
      type="button"
      onClick={() => ctx.onSelect(step.id)}
      className={clsx(
        "group absolute flex flex-col rounded-lg border bg-surface p-3 text-left shadow-pop transition-colors hover:border-line-strong",
        ctx.selectedId === step.id ? "border-accent/60 ring-[3px] ring-accent/10" : hasIssue ? "border-amber-500/50" : "border-line",
      )}
      style={style}
    >
      <span className="flex items-center gap-2">
        <span className={clsx("flex h-5 w-5 items-center justify-center rounded", meta.tint)}>
          <Icon size={12} strokeWidth={2.2} />
        </span>
        <span className="font-mono text-2xs uppercase tracking-[0.06em] text-fg-3">{meta.label}</span>
        {hasIssue && <AlertCircle size={12} className="ml-auto text-amber-500" />}
      </span>
      <span className="mt-1.5 line-clamp-2 shrink-0 text-xs leading-[1.4] text-fg">{summarize(step, ctx.defs, ctx.questions)}</span>
      {note && <span className="mt-auto shrink-0 truncate pt-1 font-mono text-2xs text-fg-4">{note}</span>}
    </button>
  );
}
