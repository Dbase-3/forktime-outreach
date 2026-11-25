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
    <div className="group relative flex h-8 items-center justify-center">
      {!hideLine && <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-line" />}
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        className="relative flex h-5 w-5 items-center justify-center rounded-full border border-line bg-surface text-fg-4 opacity-70 transition hover:scale-110 hover:border-fg-3 hover:text-fg hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent/25 group-hover:opacity-100"
      >
        <Plus size={12} strokeWidth={2.4} />
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
        "card group flex w-full items-start gap-3 p-3 text-left transition-colors hover:border-line-strong hover:bg-subtle/60 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent/25",
        ctx.selectedId === step.id && "border-accent/60 ring-[3px] ring-accent/10",
        hasIssue && "border-amber-500/40",
      )}
    >
      <span className={clsx("flex h-7 w-7 shrink-0 items-center justify-center rounded-md", meta.tint)}>
        <Icon size={14} strokeWidth={2.2} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-2xs font-medium uppercase tracking-[0.06em] text-fg-4">
          {meta.label}
          {hasIssue && <AlertCircle size={13} className="text-amber-500" />}
        </span>
        <span className="mt-0.5 line-clamp-2 block text-sm leading-snug text-fg">{summarize(step, ctx.defs, ctx.questions)}</span>
        {note && <span className="mt-1 block truncate font-mono text-2xs text-fg-4">{note}</span>}
      </span>
      <ChevronRight size={15} className="mt-1.5 shrink-0 text-fg-4 opacity-0 transition group-hover:opacity-100" />
    </button>
  );
}

function BranchBlock({ step, depth, ctx }: { step: Extract<Step, { kind: "branch" }>; depth: number; ctx: StepListContext }) {
  const sideBySide = depth === 0;
  return (
    <div className="flex flex-col items-stretch">
      <StepCard step={step} ctx={ctx} />
      <div className={clsx("mt-2 grid gap-2", sideBySide && "md:grid-cols-2")}>
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
    <div className={clsx("self-start rounded-xl border border-dashed p-2.5", tone === "yes" ? "border-emerald-500/30 bg-emerald-500/[0.03]" : "border-line-strong/70 bg-subtle/60")}>
      <div className={clsx("flex items-center gap-1.5 px-0.5 text-2xs font-medium uppercase tracking-[0.06em]", tone === "yes" ? "text-emerald-600 dark:text-emerald-400" : "text-fg-3")}>
        <span className={clsx("h-1.5 w-1.5 rounded-full", tone === "yes" ? "bg-emerald-500" : "bg-fg-4")} />
        {title}
      </div>
      {children}
      {empty && <p className="-mt-1 text-center text-xs text-fg-4">Nothing extra: the call carries on below.</p>}
    </div>
  );
}
