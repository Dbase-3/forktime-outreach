"use client";

import clsx from "clsx";
import { AlertTriangle, ArrowLeft, CheckCircle2, MessageSquareText, Play } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  TOP, allSteps, askedFields, countSteps, findStep, flowIssues, insertStep, makeStep, moveStep, removeStep, updateStep, type Container,
} from "@/lib/flow-tree";
import { nowIso, update, useApp } from "@/lib/store";
import type { Direction, Flow, Step } from "@/lib/types";
import { Badge, EmptyState, Field, Segmented, Sheet } from "../ui";
import { FlowCanvas } from "./flow-canvas";
import { PracticeSheet } from "./practice-sheet";
import { StepList, type StepListContext } from "./step-list";
import { AddStepSheet, StepSheet, type NewStepChoice } from "./step-sheet";
import { VoicePanel } from "./voice-panel";

type Tab = "steps" | "voice" | "details";

function saveFlow(id: string, fn: (flow: Flow) => Flow): void {
  update((s) => ({ ...s, flows: s.flows.map((f) => (f.id === id ? { ...fn(f), updatedAt: nowIso() } : f)) }));
}

export function FlowEditor({ id }: { id: string }) {
  const app = useApp();
  const flow = app.flows.find((f) => f.id === id);
  const [tab, setTab] = useState<Tab>("steps");
  const [practicing, setPracticing] = useState(false);

  if (!flow) {
    return (
      <EmptyState
        icon={<MessageSquareText size={22} />}
        title="This flow isn't here"
        body="It may have been deleted."
        action={<Link href="/flows" className="btn-primary">Back to flows</Link>}
      />
    );
  }

  const issues = flowIssues(flow, app.fieldDefs.map((d) => d.key));
  const edit = (fn: (f: Flow) => Flow) => saveFlow(flow.id, fn);

  return (
    <div>
      <Link href="/flows" className="mb-3 inline-flex items-center gap-1.5 text-sm text-fg-3 hover:text-fg">
        <ArrowLeft size={16} /> Flows
      </Link>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <input
          className="min-w-0 flex-1 rounded-lg bg-transparent -ml-1 px-1 py-0.5 text-xl font-semibold tracking-[-0.02em] outline-none transition-colors hover:bg-subtle focus:bg-surface focus:ring-[3px] focus:ring-fg/5"
          value={flow.name}
          onChange={(e) => edit((f) => ({ ...f, name: e.target.value }))}
          aria-label="Flow name"
        />
        <div className="flex w-full gap-2 sm:w-auto">
          <button type="button" className="btn-secondary flex-1 sm:flex-none" onClick={() => setPracticing(true)}>
            <Play size={16} /> Try it
          </button>
          <GoLive flow={flow} blocked={issues.length > 0} onToggle={() => edit((f) => ({ ...f, status: f.status === "live" ? "draft" : "live" }))} />
        </div>
      </div>

      <div className="mb-5">
        <Segmented<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { value: "steps", label: "Steps" },
            { value: "voice", label: "Voice" },
            { value: "details", label: "Details" },
          ]}
        />
      </div>

      {tab === "steps" && <StepsTab flow={flow} issues={issues} onEdit={edit} />}
      {tab === "voice" && (
        <div className="card p-5">
          <VoicePanel agent={flow.agent} onChange={(patch) => edit((f) => ({ ...f, agent: { ...f.agent, ...patch } }))} />
        </div>
      )}
      {tab === "details" && <DetailsTab flow={flow} onEdit={edit} />}

      <PracticeSheet open={practicing} onClose={() => setPracticing(false)} flow={flow} business={app.settings.businessName} contacts={app.contacts} />
    </div>
  );
}

function GoLive({ flow, blocked, onToggle }: { flow: Flow; blocked: boolean; onToggle: () => void }) {
  if (flow.status === "live") {
    return (
      <button type="button" className="btn-secondary flex-1 border-emerald-500/30 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/10 sm:flex-none" onClick={onToggle} title="Switch back to draft">
        <CheckCircle2 size={16} /> Live
      </button>
    );
  }
  return (
    <button type="button" className="btn-primary flex-1 sm:flex-none" onClick={onToggle} disabled={blocked} title={blocked ? "Fix the items above first" : undefined}>
      Go live
    </button>
  );
}

function StepsTab({ flow, issues, onEdit }: { flow: Flow; issues: ReturnType<typeof flowIssues>; onEdit: (fn: (f: Flow) => Flow) => void }) {
  const { fieldDefs } = useApp();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState<{ container: Container; index: number } | null>(null);
  const setSteps = (fn: (steps: Step[]) => Step[]) => onEdit((f) => ({ ...f, steps: fn(f.steps) }));
  const selected = selectedId ? findStep(flow.steps, selectedId) : null;
  const fields = askedFields(flow.steps);

  const questions = useMemo(
    () => Object.fromEntries(allSteps(flow.steps).flatMap((s) => (s.kind === "ask" && s.field ? [[s.field, s.question]] : []))),
    [flow.steps],
  );
  const ctx: StepListContext = useMemo(
    () => ({
      defs: fieldDefs,
      questions,
      selectedId,
      issueIds: new Set(issues.flatMap((i) => (i.stepId ? [i.stepId] : []))),
      onAdd: (container, index) => setAdding({ container, index }),
      onSelect: setSelectedId,
    }),
    [fieldDefs, questions, selectedId, issues],
  );

  const pick = (choice: NewStepChoice) => {
    if (!adding) return;
    const step = makeStep(choice.kind, choice.action);
    setSteps((steps) => insertStep(steps, adding.container, adding.index, step));
    setAdding(null);
    setSelectedId(step.id);
  };

  const [mode, setMode] = useDefaultView();
  const [greetingOpen, setGreetingOpen] = useState(false);

  return (
    <div className={clsx(mode === "list" && "mx-auto max-w-3xl")}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <Segmented<ViewMode> value={mode} onChange={setMode} options={[{ value: "canvas", label: "Canvas" }, { value: "list", label: "List" }]} />
        <span className="hidden text-xs text-fg-4 sm:inline">{countSteps(flow.steps)} steps · click a box to edit it, + to add</span>
      </div>
      {issues.length > 0 && <IssueList issues={issues} onSelect={setSelectedId} />}
      {mode === "canvas" ? (
        <FlowCanvas steps={flow.steps} greeting={flow.greeting} ctx={ctx} onAddAt={(at) => setAdding(at)} onEditGreeting={() => setGreetingOpen(true)} />
      ) : (
        <>
          <GreetingCard greeting={flow.greeting} onChange={(greeting) => onEdit((f) => ({ ...f, greeting }))} />
          <StepList steps={flow.steps} container={TOP} depth={0} ctx={ctx} />
          {flow.steps.length === 0 && <p className="text-center text-sm text-fg-3">Tap + to add the first step.</p>}
        </>
      )}

      <Sheet open={greetingOpen} onClose={() => setGreetingOpen(false)} title="Start of the call" footer={<button type="button" className="btn-primary w-full" onClick={() => setGreetingOpen(false)}>Done</button>}>
        <GreetingCard greeting={flow.greeting} onChange={(greeting) => onEdit((f) => ({ ...f, greeting }))} />
      </Sheet>
      <AddStepSheet open={adding !== null} onClose={() => setAdding(null)} onPick={pick} />
      <StepSheet
        step={selected}
        defs={fieldDefs}
        askedFields={fields}
        onChange={(patch) => selectedId && setSteps((steps) => updateStep(steps, selectedId, patch))}
        onMove={(delta) => selectedId && setSteps((steps) => moveStep(steps, selectedId, delta))}
        onDelete={() => {
          if (!selectedId) return;
          setSteps((steps) => removeStep(steps, selectedId));
          setSelectedId(null);
        }}
        onClose={() => setSelectedId(null)}
      />
    </div>
  );
}

type ViewMode = "canvas" | "list";

/** Canvas on wide screens, list on phones; the person can switch either way. */
function useDefaultView(): [ViewMode, (m: ViewMode) => void] {
  const [mode, setMode] = useState<ViewMode>("list");
  useEffect(() => {
    if (window.matchMedia("(min-width: 768px)").matches) setMode("canvas");
  }, []);
  return [mode, setMode];
}

function GreetingCard({ greeting, onChange }: { greeting: string; onChange: (greeting: string) => void }) {
  return (
    <div className="card overflow-hidden focus-within:border-fg-3">
      <div className="flex items-center gap-2 border-b border-line bg-subtle px-3 py-2 font-mono text-2xs uppercase tracking-[0.06em] text-fg-3">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
          <span className="relative h-1.5 w-1.5 rounded-full bg-emerald-500" />
        </span>
        Call starts · the agent says
      </div>
      <textarea
        className="block w-full resize-none bg-transparent px-3 py-2.5 text-sm leading-relaxed outline-none"
        rows={3}
        value={greeting}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Greeting"
      />
      <p className="px-3 pb-2.5 text-2xs text-fg-4">Keep &ldquo;AI assistant&rdquo; and &ldquo;recorded&rdquo; in the greeting: callers must be told.</p>
    </div>
  );
}

function IssueList({ issues, onSelect }: { issues: ReturnType<typeof flowIssues>; onSelect: (id: string) => void }) {
  return (
    <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-300">
        <AlertTriangle size={16} /> {issues.length === 1 ? "1 thing to fix before going live" : `${issues.length} things to fix before going live`}
      </div>
      <ul className="mt-2 space-y-1">
        {issues.map((issue, i) => (
          <li key={i}>
            <button
              type="button"
              disabled={!issue.stepId}
              onClick={() => issue.stepId && onSelect(issue.stepId)}
              className={clsx("text-left text-sm text-amber-800 dark:text-amber-200", issue.stepId && "underline decoration-amber-300 underline-offset-2 hover:decoration-amber-600")}
            >
              {issue.message}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DetailsTab({ flow, onEdit }: { flow: Flow; onEdit: (fn: (f: Flow) => Flow) => void }) {
  return (
    <div className="card space-y-5 p-5">
      <div>
        <span className="label">Used for</span>
        <Segmented<Direction>
          value={flow.direction}
          onChange={(direction) => onEdit((f) => ({ ...f, direction }))}
          options={[
            { value: "outbound", label: "Calls we make" },
            { value: "inbound", label: "Calls we answer" },
            { value: "both", label: "Both" },
          ]}
        />
      </div>
      <Field label="Short description">
        <input className="field" value={flow.description} onChange={(e) => onEdit((f) => ({ ...f, description: e.target.value }))} />
      </Field>
      <Field label="What the agent knows" hint="Opening hours, prices, policies, FAQs. The agent answers only from this and says so when it doesn't know.">
        <textarea className="field min-h-48" value={flow.knowledge} onChange={(e) => onEdit((f) => ({ ...f, knowledge: e.target.value }))} placeholder={"We're open Monday to Friday, 9am to 6pm.\nA standard service is $249."} />
      </Field>
      <div className="flex items-center justify-between rounded-lg bg-subtle p-3 text-sm">
        <span className="text-fg-3">Status</span>
        <Badge tone={flow.status === "live" ? "green" : "gray"} dot>{flow.status === "live" ? "Live" : "Draft"}</Badge>
      </div>
    </div>
  );
}
