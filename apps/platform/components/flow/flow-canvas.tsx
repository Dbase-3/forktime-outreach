"use client";

// The flow as a picture on a dotted canvas: boxes, curved lines, Yes /
// Otherwise labels on decisions, and a "+" on every line to add a step there.
// Layout is automatic (lib/flow-layout.ts); people pan and zoom, never drag boxes.

import clsx from "clsx";
import { AlertCircle, Flag, Maximize2, Minus, Play, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { DRAG_THRESHOLD, distance, fitAll, midpoint, pinch, wheelZoomSpeed, zoomAt, type Point, type View } from "@/lib/canvas-view";
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


type Gesture =
  | { kind: "drag"; id: number; start: Point; view: View; moving: boolean }
  | { kind: "pinch"; view: View; mid: Point; dist: number };

export function FlowCanvas({ steps, greeting, ctx, onAddAt, onEditGreeting }: Props) {
  const layout = useMemo(() => layoutFlow(steps), [steps]);
  const box = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ x: 0, y: 40, z: 1 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<Gesture | null>(null);
  const swallowClick = useRef(false); // a drag that started on a box must not also open it
  const [grabbing, setGrabbing] = useState(false);
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

  /** The whole workflow on screen (the percentage and the fit button). */
  const showAll = () => {
    const el = box.current;
    if (!el) return;
    setView(fitAll(layout, { width: el.clientWidth, height: el.clientHeight }));
  };

  // Trackpad and mouse wheel (owner, 2026-11-26, like ElevenLabs / React Flow):
  // two-finger scroll and pinch both ZOOM around the pointer; moving is click
  // and drag. Shift + scroll still moves, for anyone who wants it. Chrome and
  // Firefox send a pinch as ctrl + wheel; Safari as its own gesture events.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const at = (e: { clientX: number; clientY: number }) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.shiftKey) {
        setView((v) => ({ ...v, x: v.x - (event.deltaX || event.deltaY), y: v.y }));
        return;
      }
      const p = at(event);
      setView((v) => zoomAt(v, p.x, p.y, Math.exp(-event.deltaY * wheelZoomSpeed(event))));
    };
    type SafariGesture = Event & { scale: number; clientX: number; clientY: number };
    let gestureStart: View | null = null;
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      gestureStart = viewRef.current;
    };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const g = e as SafariGesture;
      if (!gestureStart) return;
      const p = at(g);
      setView(zoomAt(gestureStart, p.x, p.y, g.scale));
    };
    const onGestureEnd = (e: Event) => {
      e.preventDefault();
      gestureStart = null;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("gesturestart", onGestureStart);
    el.addEventListener("gesturechange", onGestureChange);
    el.addEventListener("gestureend", onGestureEnd);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("gesturestart", onGestureStart);
      el.removeEventListener("gesturechange", onGestureChange);
      el.removeEventListener("gestureend", onGestureEnd);
    };
  }, []);

  const local = (event: ReactPointerEvent): Point => {
    const r = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - r.left, y: event.clientY - r.top };
  };

  // Pointers: one finger or the mouse drags (from anywhere, boxes included,
  // once it has moved a few pixels; a plain click still opens a box), two
  // fingers pinch to zoom and pan together.
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("[data-canvas-controls]")) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    pointers.current.set(event.pointerId, local(event));
    if (pointers.current.size === 1) {
      swallowClick.current = false;
      gesture.current = { kind: "drag", id: event.pointerId, start: local(event), view: viewRef.current, moving: false };
      return;
    }
    const [a, b] = [...pointers.current.values()];
    gesture.current = { kind: "pinch", view: viewRef.current, mid: midpoint(a, b), dist: distance(a, b) };
    swallowClick.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    const p = local(event);
    pointers.current.set(event.pointerId, p);
    const g = gesture.current;
    if (!g) return;
    if (g.kind === "pinch") {
      const [a, b] = [...pointers.current.values()];
      if (a && b) setView(pinch(g.view, g.mid, g.dist, midpoint(a, b), distance(a, b)));
      return;
    }
    if (g.id !== event.pointerId) return;
    const dx = p.x - g.start.x;
    const dy = p.y - g.start.y;
    if (!g.moving) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      g.moving = true;
      swallowClick.current = true;
      setGrabbing(true);
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    setView({ ...g.view, x: g.view.x + dx, y: g.view.y + dy });
  };

  const onPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size === 0) {
      gesture.current = null;
      setGrabbing(false);
      return;
    }
    // Lifting one of two fingers carries on as a drag with the other.
    const [[id, p]] = [...pointers.current.entries()];
    gesture.current = { kind: "drag", id, start: p, view: viewRef.current, moving: true };
  };

  const zoomBy = (factor: number) => {
    const el = box.current;
    if (!el) return;
    setView((v) => zoomAt(v, el.clientWidth / 2, el.clientHeight / 2, factor));
  };

  const byId = new Map(layout.nodes.map((n) => [n.id, n]));

  return (
    <div
      ref={box}
      className="relative h-full min-h-[420px] touch-none select-none overflow-hidden bg-surface [background-image:radial-gradient(rgb(var(--line-strong))_1px,transparent_1px)] [background-size:18px_18px]"
      style={{ backgroundPosition: `${view.x}px ${view.y}px`, cursor: grabbing ? "grabbing" : "grab" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onClickCapture={(e) => {
        if (!swallowClick.current) return;
        swallowClick.current = false;
        e.stopPropagation();
        e.preventDefault();
      }}
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

      <div data-canvas-controls className="absolute bottom-3 right-3 flex items-center gap-0.5 rounded-lg border border-line bg-surface p-0.5 shadow-pop">
        <button type="button" className="btn-icon h-7 w-7" onClick={() => zoomBy(1 / 1.2)} aria-label="Zoom out"><Minus size={14} /></button>
        <button type="button" onClick={showAll} title="Fit the whole workflow" aria-label="Fit the whole workflow" className="h-7 w-12 rounded-md text-center font-mono text-2xs tabular-nums text-fg-3 transition-colors hover:bg-muted hover:text-fg">{Math.round(view.z * 100)}%</button>
        <button type="button" className="btn-icon h-7 w-7" onClick={() => zoomBy(1.2)} aria-label="Zoom in"><Plus size={14} /></button>
        <span className="mx-0.5 h-4 w-px bg-line" />
        <button type="button" className="btn-icon h-7 w-7" onClick={showAll} aria-label="Fit the whole workflow" title="Fit the whole workflow"><Maximize2 size={13} /></button>
      </div>
      <div className="pointer-events-none absolute bottom-3 left-3 hidden font-mono text-2xs text-fg-4 sm:block">Scroll or pinch to zoom · drag to move</div>
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
        ctx.activeId === step.id ? "border-emerald-500/70 ring-[3px] ring-emerald-500/20" : ctx.selectedId === step.id ? "border-accent/60 ring-[3px] ring-accent/10" : hasIssue ? "border-amber-500/50" : "border-line",
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
