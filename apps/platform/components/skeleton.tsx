// Loading placeholders. Every page has one shaped like the real thing, so
// nothing jumps when data arrives. Used by each route's loading.tsx, by the
// shell on first load, and inside slow pieces (charts) until they can draw.

import clsx from "clsx";
import type { CSSProperties } from "react";

export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return <div className={clsx("skeleton rounded-md", className)} style={style} aria-hidden />;
}

function Header({ action = true }: { action?: boolean }) {
  return (
    <div className="mb-6 flex items-end justify-between gap-3">
      <div className="space-y-2">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-3.5 w-64 max-w-[70vw]" />
      </div>
      {action && <Skeleton className="h-8 w-28 rounded-lg" />}
    </div>
  );
}

function Rows({ count = 6, avatar = true }: { count?: number; avatar?: boolean }) {
  return (
    <div className="card divide-y divide-line overflow-hidden">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          {avatar && <Skeleton className="h-8 w-8 rounded-full" />}
          <div className="flex-1 space-y-1.5">
            <Skeleton className={clsx("h-3.5", ["w-40", "w-32", "w-48"][i % 3])} />
            <Skeleton className={clsx("h-3", ["w-2/3", "w-1/2", "w-3/5"][i % 3])} />
          </div>
          <Skeleton className="h-5 w-16" />
        </div>
      ))}
    </div>
  );
}

export function ChartSkeleton({ height = 220 }: { height?: number }) {
  return (
    <div className="flex items-end gap-1.5" style={{ height }} aria-hidden>
      {[38, 52, 30, 64, 48, 72, 40, 58, 66, 44, 80, 54, 62, 70].map((h, i) => (
        <Skeleton key={i} className="flex-1 rounded-sm" style={{ height: `${h}%` }} />
      ))}
    </div>
  );
}

export function HomeSkeleton() {
  return (
    <div className="space-y-6">
      <Header />
      <div className="card grid grid-cols-2 overflow-hidden lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={clsx("space-y-2.5 p-4 sm:p-5", i % 2 === 1 && "border-l border-line", i >= 2 && "border-t border-line lg:border-t-0", i === 2 && "lg:border-l")}>
            <Skeleton className="h-2.5 w-24" />
            <Skeleton className="h-6 w-14" />
          </div>
        ))}
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="card space-y-3 p-4">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-2.5 w-20" />
            <Skeleton className="h-7 w-full" />
          </div>
        ))}
      </div>
      <div className="card p-5">
        <Skeleton className="mb-5 h-3 w-40" />
        <ChartSkeleton />
      </div>
    </div>
  );
}

export function ListSkeleton({ filters = true }: { filters?: boolean }) {
  return (
    <div>
      <Header />
      {filters && <Skeleton className="mb-4 h-8 w-64 rounded-lg" />}
      <Rows />
    </div>
  );
}

export function CardsSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div>
      <Header />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: count }, (_, i) => (
          <div key={i} className="card space-y-3 p-4">
            <div className="flex justify-between">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-5 w-12" />
            </div>
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-2/3" />
            <div className="border-t border-line pt-3">
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function EditorSkeleton() {
  return (
    <div>
      <Skeleton className="mb-4 h-3.5 w-20" />
      <div className="mb-5 flex justify-between">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-8 w-40 rounded-lg" />
      </div>
      <Skeleton className="mb-5 h-8 w-56 rounded-lg" />
      <div className="mx-auto max-w-3xl space-y-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card flex gap-3 p-3">
            <Skeleton className="h-7 w-7" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-2.5 w-14" />
              <Skeleton className="h-3.5 w-3/4" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function FormSkeleton() {
  return (
    <div className="max-w-4xl">
      <Header action={false} />
      <div className="space-y-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="card grid gap-6 p-5 md:grid-cols-[240px_1fr]">
            <div className="space-y-2">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-3 w-44" />
            </div>
            <div className="space-y-3">
              <Skeleton className="h-9 w-full rounded-lg" />
              <Skeleton className="h-9 w-2/3 rounded-lg" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Which skeleton fits a path: used by the shell before the workspace is ready. */
export function SkeletonFor({ pathname }: { pathname: string }) {
  if (pathname === "/") return <HomeSkeleton />;
  if (/^\/agents\/[^/]+/.test(pathname)) return <EditorSkeleton />;
  if (/^\/(agents|campaigns|integrations)/.test(pathname)) return <CardsSkeleton />;
  if (pathname.startsWith("/knowledge")) return <ListSkeleton />;
  if (pathname.startsWith("/settings")) return <FormSkeleton />;
  return <ListSkeleton />;
}
