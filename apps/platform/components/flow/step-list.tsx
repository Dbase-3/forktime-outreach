"use client";

// The flow drawn top to bottom: cards joined by a line, a "+" between every two
// steps, and a decision splitting into "If yes" / "Otherwise" lanes.

import clsx from "clsx";
import { AlertCircle, ChevronRight, Plus } from "lucide-react";
import type { Container } from "@/lib/flow-tree";
import type { FieldDef, Step } from "@/lib/types";
import { footnote, metaOf, summarize } from "./meta";

export interface StepListContext {
  defs: FieldDef[];
  questions: Record<string, string>; // saved field → the question that asks it
  selectedId: string | null;
  issueIds: Set<string>;
  onAdd: (container: Container, index: number) => void;
  onSelect: (id: string) => void;
}

export function StepList({ steps, container, depth, ctx }: { steps: Step[]; container: Container; depth: number; ctx: StepListContext }) {
  return (
    <div className="flex flex-col items-stretch">
      <AddPoint onClick={() => ctx.onAdd(container, 0)} label="Add a step here" />
      {steps.map((step, index) => (
        <div key={step.id} className="flex flex-col items-stretch">
          {step.kind === "branch" ? <BranchBlock step={step} depth={depth} ctx={ctx} /> : <StepCard step={step} ctx={ctx} />}
          <AddPoint onClick={() => ctx.onAdd(container, index + 1)} label="Add a step here" hideLine={step.kind === "end" && index === steps.length - 1} />
        </div>
      ))}
    </div>
  );
}

function AddPoint({ onClick, label, hideLine }: { onClick: () => void; label: string; hideLine?: boolean }) {
  return (
    <div className="group relative flex h-10 items-center justify-center">
      {!hideLine && <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-zinc-200" />}
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        className="relative flex h-6 w-6 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-400 shadow-sm transition hover:scale-110 hover:border-brand-300 hover:text-brand-600 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-500/20"
      >
        <Plus size={14} />
      </button>
    </div>
  );
}

export function StepCard({ step, ctx }: { step: Step; ctx: StepListContext }) {
  const meta = metaOf(step);
  const Icon = meta.icon;
  const note = footnote(step);
  const hasIssue = ctx.issueIds.has(step.id);
  return (
    <button
      type="button"
      onClick={() => ctx.onSelect(step.id)}
      className={clsx(
        "card group flex w-full items-start gap-3 p-3.5 text-left transition hover:border-zinc-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-500/20",
        ctx.selectedId === step.id && "border-brand-400 ring-4 ring-brand-500/10",
        hasIssue && "border-amber-300",
      )}
    >
      <span className={clsx("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", meta.tint)}>
        <Icon size={17} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-xs font-medium text-zinc-500">
          {meta.label}
          {hasIssue && <AlertCircle size={13} className="text-amber-500" />}
        </span>
        <span className="mt-0.5 line-clamp-2 block text-[15px] leading-snug text-zinc-900 sm:text-sm">{summarize(step, ctx.defs, ctx.questions)}</span>
        {note && <span className="mt-1 block truncate text-xs text-zinc-400">{note}</span>}
      </span>
      <ChevronRight size={16} className="mt-2.5 shrink-0 text-zinc-300 transition group-hover:text-zinc-500" />
    </button>
  );
}

function BranchBlock({ step, depth, ctx }: { step: Extract<Step, { kind: "branch" }>; depth: number; ctx: StepListContext }) {
  const sideBySide = depth === 0;
  return (
    <div className="flex flex-col items-stretch">
      <StepCard step={step} ctx={ctx} />
      <div className={clsx("mt-3 grid gap-3", sideBySide && "md:grid-cols-2")}>
        <Lane title="If yes" tone="yes" empty={step.yes.length === 0}>
          <StepList steps={step.yes} container={{ branchId: step.id, side: "yes" }} depth={depth + 1} ctx={ctx} />
        </Lane>
        <Lane title="Otherwise" tone="no" empty={step.no.length === 0}>
          <StepList steps={step.no} container={{ branchId: step.id, side: "no" }} depth={depth + 1} ctx={ctx} />
        </Lane>
      </div>
    </div>
  );
}

function Lane({ title, tone, empty, children }: { title: string; tone: "yes" | "no"; empty: boolean; children: React.ReactNode }) {
  return (
    <div className={clsx("self-start rounded-2xl border border-dashed p-3", tone === "yes" ? "border-emerald-200 bg-emerald-50/40" : "border-zinc-200 bg-zinc-100/40")}>
      <div className={clsx("text-xs font-semibold uppercase tracking-wide", tone === "yes" ? "text-emerald-700" : "text-zinc-500")}>{title}</div>
      {children}
      {empty && <p className="-mt-1 text-center text-xs text-zinc-400">Nothing extra: the call carries on below.</p>}
    </div>
  );
}
