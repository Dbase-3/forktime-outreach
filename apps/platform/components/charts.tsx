"use client";

// Charts drawn in plain SVG, sized to their box. Colours come from the
// --series-* tokens (validated light/dark pairs); text always uses text tokens.

import { useEffect, useId, useRef, useState, type PointerEvent, type RefObject } from "react";
import { ChartSkeleton } from "./skeleton";

export interface Series {
  key: string;
  label: string;
  color: string; // a CSS colour, e.g. "rgb(var(--series-1))"
}

export interface ChartPoint {
  label: string; // tooltip heading, e.g. "Tue 24 Nov"
  tick: string; // short axis label, e.g. "24"
  values: Record<string, number>;
}

function useWidth<T extends HTMLElement>(): [RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/** Clean axis steps: 0, 5, 10… or 0, 2, 4… */
function niceMax(max: number): { top: number; step: number } {
  if (max <= 4) return { top: 4, step: 1 };
  const raw = max / 3;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw;
  return { top: Math.ceil(max / step) * step, step };
}

const PAD = { top: 12, right: 8, bottom: 24, left: 28 };

export function AreaChart({ points, series, height = 220 }: { points: ChartPoint[]; series: Series[]; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const id = useId().replace(/:/g, "");
  const max = Math.max(1, ...points.flatMap((p) => series.map((s) => p.values[s.key] ?? 0)));
  const { top, step } = niceMax(max);
  const innerW = Math.max(0, width - PAD.left - PAD.right);
  const innerH = height - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (points.length <= 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v: number) => PAD.top + innerH - (v / top) * innerH;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const every = Math.max(1, Math.ceil(points.length / Math.max(1, Math.floor(innerW / 56))));

  const onMove = (event: PointerEvent<SVGRectElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - box.left) / box.width;
    setHover(Math.max(0, Math.min(points.length - 1, Math.round(ratio * (points.length - 1)))));
  };

  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      {width === 0 && <ChartSkeleton height={height} />}
      {width > 0 && (
        <svg width={width} height={height} className="block overflow-visible" role="img" aria-label={`Chart of ${series.map((s) => s.label).join(" and ")}`}>
          <defs>
            {series.map((s) => (
              <pattern key={s.key} id={`${id}-${s.key}`} width="4" height="4" patternUnits="userSpaceOnUse">
                <circle cx="1" cy="1" r="0.9" fill={s.color} opacity="0.55" />
              </pattern>
            ))}
          </defs>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke="rgb(var(--line))" strokeWidth="1" />
              <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-fg-4 font-mono text-2xs">{t}</text>
            </g>
          ))}
          {points.map((p, i) =>
            (i % every === 0 && points.length - 1 - i >= every) || i === points.length - 1 ? (
              <text key={p.label} x={x(i)} y={height - 6} textAnchor="middle" className="fill-fg-4 font-mono text-2xs">{p.tick}</text>
            ) : null,
          )}
          {series.map((s) => {
            const line = points.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.values[s.key] ?? 0)}`).join(" ");
            const area = `${line} L${x(points.length - 1)},${y(0)} L${x(0)},${y(0)} Z`;
            return (
              <g key={s.key}>
                <path d={area} fill={`url(#${id}-${s.key})`} opacity="0.35" />
                <path d={line} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
              </g>
            );
          })}
          {hover !== null && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + innerH} stroke="rgb(var(--fg-4))" strokeWidth="1" />
              {series.map((s) => (
                <circle key={s.key} cx={x(hover)} cy={y(points[hover].values[s.key] ?? 0)} r="4" fill={s.color} stroke="rgb(var(--surface))" strokeWidth="2" />
              ))}
            </g>
          )}
          <rect x={PAD.left} y={PAD.top} width={innerW} height={innerH} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
        </svg>
      )}
      {hover !== null && width > 0 && <Tooltip point={points[hover]} series={series} left={x(hover)} width={width} />}
    </div>
  );
}

function Tooltip({ point, series, left, width }: { point: ChartPoint; series: Series[]; left: number; width: number }) {
  const flip = left > width - 160;
  return (
    <div className="pointer-events-none absolute top-1 z-10 min-w-36 rounded-lg border border-line bg-surface px-3 py-2 shadow-pop" style={flip ? { right: width - left + 12 } : { left: left + 12 }}>
      <div className="mb-1 text-2xs font-medium text-fg-3">{point.label}</div>
      {series.map((s) => (
        <div key={s.key} className="flex items-center gap-2 text-xs">
          <span className="h-2 w-2 rounded-sm" style={{ background: s.color }} />
          <span className="flex-1 text-fg-2">{s.label}</span>
          <span className="font-mono font-medium tabular-nums text-fg">{point.values[s.key] ?? 0}</span>
        </div>
      ))}
    </div>
  );
}

export function Legend({ series, totals }: { series: Series[]; totals?: Record<string, number> }) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
      {series.map((s) => (
        <span key={s.key} className="flex items-center gap-2 text-xs text-fg-2">
          <span className="h-0.5 w-3 rounded-full" style={{ background: s.color }} />
          {s.label}
          {totals && <span className="font-mono tabular-nums text-fg">{totals[s.key]}</span>}
        </span>
      ))}
    </div>
  );
}

/** A tiny trend line for cards: one series, no axes. */
export function Sparkline({ values, color = "rgb(var(--series-1))", height = 28 }: { values: number[]; color?: string; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const max = Math.max(1, ...values);
  const x = (i: number) => (values.length <= 1 ? width / 2 : (i / (values.length - 1)) * (width - 2) + 1);
  const y = (v: number) => height - 2 - (v / max) * (height - 4);
  const line = values.map((v, i) => `${i ? "L" : "M"}${x(i)},${y(v)}`).join(" ");
  return (
    <div ref={ref} className="w-full" style={{ height }} aria-hidden>
      {width > 0 && (
        <svg width={width} height={height} className="block">
          <path d={`${line} L${x(values.length - 1)},${height} L${x(0)},${height} Z`} fill={color} opacity="0.1" />
          <path d={line} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
      )}
    </div>
  );
}
