"use client";

// One agent, on a split screen like ElevenLabs: the workflow on the left
// (canvas, or a list), and on the right a panel to test it live, set its
// voice, knowledge and the data it collects, or edit the step you clicked.

import clsx from "clsx";
import { AlertTriangle, ArrowDown, ArrowLeft, ArrowUp, CheckCircle2, MessageSquareText, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { docsForAgent } from "@/lib/knowledge";
import { dataSchema } from "@/lib/agent-data";
import { TOP, allSteps, findStep, flowIssues, insertStep, makeStep, moveStep, removeStep, updateStep, type Container } from "@/lib/flow-tree";
import { nowIso, update, useApp } from "@/lib/store";
import type { Direction, Flow, Step } from "@/lib/types";
import { FlowCanvas } from "../flow/flow-canvas";
import { metaOf } from "../flow/meta";
import { StepList, type StepListContext } from "../flow/step-list";
import { AddStepSheet, StepForm, decisionFields, type NewStepChoice } from "../flow/step-sheet";
import { VoicePanel } from "../flow/voice-panel";
import { Popover } from "../popover";
import { EmptyState, Field, Segmented } from "../ui";
import { DataTab } from "./data-tab";
import { KnowledgeTab } from "./knowledge-tab";
import { TestPanel } from "./test-panel";

type PanelTab = "test" | "agent" | "knowledge" | "data" | "step";
type View = "canvas" | "list";

function saveFlow(id: string, fn: (flow: Flow) => Flow): void {
  update((s) => ({ ...s, flows: s.flows.map((f) => (f.id === id ? { ...fn(f), updatedAt: nowIso() } : f)) }));
}

export function AgentEditor({ id }: { id: string }) {
  const app = useApp();
  const flow = app.flows.find((f) => f.id === id);
  const [tab, setTab] = useState<PanelTab>("test");
  const [lastTab, setLastTab] = useState<Exclude<PanelTab, "step">>("test");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [adding, setAdding] = useState<{ container: Container; index: number } | null>(null);
  const [view, setView] = useState<View>("list");
  const [mobilePane, setMobilePane] = useState<"workflow" | "panel">("workflow");

  useEffect(() => {
    if (window.matchMedia("(min-width: 768px)").matches) setView("canvas");
  }, []);

  const select = useCallback(
    (stepId: string | null) => {
      setSelectedId(stepId);
      if (stepId) {
        if (tab !== "step") setLastTab(tab as Exclude<PanelTab, "step">);
        setTab("step");
        setMobilePane("panel");
      } else if (tab === "step") setTab(lastTab);
    },
    [tab, lastTab],
  );

  const steps = useMemo(() => flow?.steps ?? [], [flow?.steps]);
  const issues = useMemo(() => (flow ? flowIssues(flow, app.fieldDefs.map((d) => d.key)) : []), [flow, app.fieldDefs]);
  const questions = useMemo(() => Object.fromEntries(allSteps(steps).flatMap((s) => (s.kind === "ask" && s.field ? [[s.field, s.question]] : []))), [steps]);
  const ctx: StepListContext = useMemo(
    () => ({
      defs: app.fieldDefs,
      questions,
      selectedId,
      activeId: tab === "test" ? activeId : null,
      issueIds: new Set(issues.flatMap((i) => (i.stepId ? [i.stepId] : []))),
      onAdd: (container, index) => setAdding({ container, index }),
      onSelect: (sid) => select(sid),
    }),
    [app.fieldDefs, questions, selectedId, activeId, tab, issues, select],
  );

  if (!flow) {
    return <EmptyState icon={<MessageSquareText size={20} />} title="This agent isn't here" body="It may have been deleted." action={<Link href="/agents" className="btn-primary">Back to agents</Link>} />;
  }

  const edit = (fn: (f: Flow) => Flow) => saveFlow(flow.id, fn);
  const setSteps = (fn: (s: Step[]) => Step[]) => edit((f) => ({ ...f, steps: fn(f.steps) }));
  const selected = selectedId ? findStep(flow.steps, selectedId) : null;
  const pick = (choice: NewStepChoice) => {
    if (!adding) return;
    const step = makeStep(choice.kind, choice.action);
    setSteps((s) => insertStep(s, adding.container, adding.index, step));
    setAdding(null);
    select(step.id);
  };

  const tabs: { id: PanelTab; label: string; count?: number }[] = [
    { id: "test", label: "Test" },
    { id: "agent", label: "Agent" },
    { id: "knowledge", label: "Knowledge", count: docsForAgent(app, flow).length },
    { id: "data", label: "Data", count: dataSchema(flow).length },
    ...(selected ? [{ id: "step" as const, label: metaOf(selected).label }] : []),
  ];

  return (
    <div className="flex h-[calc(100dvh-48px)] flex-col max-lg:h-[calc(100dvh-48px-60px)]">
      {/* Header */}
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-3 sm:px-4">
        <Link href="/agents" className="btn-icon" aria-label="All agents"><ArrowLeft size={16} /></Link>
        <input
          className="min-w-0 flex-1 rounded-md bg-transparent px-1.5 py-1 text-base font-semibold tracking-[-0.01em] outline-none transition-colors hover:bg-subtle focus:bg-surface focus:ring-[3px] focus:ring-fg/5"
          value={flow.name}
          onChange={(e) => edit((f) => ({ ...f, name: e.target.value }))}
          aria-label="Agent name"
        />
        {issues.length > 0 && (
          <Popover align="end" className="w-80" trigger={<button type="button" className="btn-ghost h-8 px-2 text-amber-700 dark:text-amber-400"><AlertTriangle size={15} /> {issues.length}</button>}>
            <div className="mb-1.5 text-sm font-medium">Fix before going live</div>
            <ul className="space-y-1">
              {issues.map((issue, i) => (
                <li key={i}>
                  <button type="button" disabled={!issue.stepId} onClick={() => issue.stepId && select(issue.stepId)} className="w-full rounded-md px-2 py-1.5 text-left text-sm text-fg-2 hover:bg-muted disabled:hover:bg-transparent">{issue.message}</button>
                </li>
              ))}
            </ul>
          </Popover>
        )}
        {flow.status === "live" ? (
          <button type="button" className="btn-secondary h-8 border-emerald-500/40 text-emerald-700 dark:text-emerald-400" onClick={() => edit((f) => ({ ...f, status: "draft" }))} title="Switch back to draft"><CheckCircle2 size={15} /> Live</button>
        ) : (
          <button type="button" className="btn-primary h-8" disabled={issues.length > 0} onClick={() => edit((f) => ({ ...f, status: "live" }))}>Go live</button>
        )}
      </div>

      {/* Phones: one pane at a time */}
      <div className="flex shrink-0 border-b border-line px-3 py-2 md:hidden">
        <Segmented<"workflow" | "panel"> value={mobilePane} onChange={setMobilePane} options={[{ value: "workflow", label: "Workflow" }, { value: "panel", label: tab === "step" && selected ? metaOf(selected).label : "Test & settings" }]} />
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Workflow */}
        <div className={clsx("relative min-w-0 flex-1", mobilePane === "panel" && "max-md:hidden")}>
          <div className="absolute left-3 top-3 z-10">
            <Segmented<View> value={view} onChange={setView} options={[{ value: "canvas", label: "Canvas" }, { value: "list", label: "List" }]} />
          </div>
          {view === "canvas" ? (
            <FlowCanvas steps={flow.steps} greeting={flow.greeting} ctx={ctx} onAddAt={(at) => setAdding(at)} onEditGreeting={() => { setLastTab("agent"); setTab("agent"); setSelectedId(null); setMobilePane("panel"); }} />
          ) : (
            <div className="h-full overflow-y-auto px-4 pb-10 pt-16">
              <div className="mx-auto max-w-2xl">
                <StepList steps={flow.steps} container={TOP} depth={0} ctx={ctx} />
              </div>
            </div>
          )}
        </div>

        {/* Panel */}
        <aside className={clsx("flex w-full min-w-0 flex-col border-line bg-surface md:w-[400px] md:shrink-0 md:border-l xl:w-[440px]", mobilePane === "workflow" && "max-md:hidden")}>
          <div className="flex shrink-0 gap-4 overflow-x-auto border-b border-line px-4" role="tablist">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => {
                  if (t.id !== "step") {
                    setSelectedId(null);
                    setLastTab(t.id);
                  }
                  setTab(t.id);
                }}
                className={clsx("-mb-px shrink-0 border-b-2 py-3 text-sm font-medium transition-colors", tab === t.id ? "border-fg text-fg" : "border-transparent text-fg-3 hover:text-fg")}
              >
                {t.label}
                {t.count !== undefined && <span className="ml-1 font-mono text-xs text-fg-4">{t.count}</span>}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {tab === "test" && <TestPanel flow={flow} business={app.settings.businessName} contacts={app.contacts} onActiveStep={setActiveId} />}
            {tab === "agent" && <AgentTab flow={flow} onEdit={edit} />}
            {tab === "knowledge" && <KnowledgeTab flow={flow} />}
            {tab === "data" && <DataTab flow={flow} onEdit={edit} />}
            {tab === "step" && selected && (
              <StepPanel
                step={selected}
                flow={flow}
                fields={decisionFields(flow.steps, app.fieldDefs)}
                onChange={(patch) => setSteps((s) => updateStep(s, selected.id, patch))}
                onMove={(d) => setSteps((s) => moveStep(s, selected.id, d))}
                onDelete={() => {
                  setSteps((s) => removeStep(s, selected.id));
                  select(null);
                }}
                onClose={() => select(null)}
              />
            )}
          </div>
        </aside>
      </div>

      <AddStepSheet open={adding !== null} onClose={() => setAdding(null)} onPick={pick} />
    </div>
  );
}

function StepPanel({ step, fields, onChange, onMove, onDelete, onClose }: { step: Step; flow: Flow; fields: ReturnType<typeof decisionFields>; onChange: (p: Partial<Step>) => void; onMove: (d: -1 | 1) => void; onDelete: () => void; onClose: () => void }) {
  const meta = metaOf(step);
  const Icon = meta.icon;
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <span className={clsx("flex h-6 w-6 items-center justify-center rounded-md", meta.tint)}><Icon size={13} /></span>
        <span className="flex-1 text-sm font-medium">{meta.label}</span>
        <button type="button" className="btn-icon h-7 w-7" onClick={() => onMove(-1)} aria-label="Move up"><ArrowUp size={14} /></button>
        <button type="button" className="btn-icon h-7 w-7" onClick={() => onMove(1)} aria-label="Move down"><ArrowDown size={14} /></button>
        <button type="button" className="btn-icon h-7 w-7 hover:text-rose-600" onClick={onDelete} aria-label="Delete step"><Trash2 size={14} /></button>
        <button type="button" className="btn-icon h-7 w-7" onClick={onClose} aria-label="Close step"><X size={14} /></button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        <StepForm key={step.id} step={step} fields={fields} onChange={onChange} />
      </div>
    </div>
  );
}

function AgentTab({ flow, onEdit }: { flow: Flow; onEdit: (fn: (f: Flow) => Flow) => void }) {
  return (
    <div className="space-y-6 p-4">
      <Field label="The agent says first" hint="Keep “AI assistant” and “recorded” in it: callers must be told.">
        <textarea className="field min-h-24 leading-relaxed" value={flow.greeting} onChange={(e) => onEdit((f) => ({ ...f, greeting: e.target.value }))} />
      </Field>
      <div>
        <span className="label">Used for</span>
        <Segmented<Direction>
          value={flow.direction}
          onChange={(direction) => onEdit((f) => ({ ...f, direction }))}
          options={[
            { value: "outbound", label: "Making calls" },
            { value: "inbound", label: "Answering" },
            { value: "both", label: "Both" },
          ]}
        />
      </div>
      <Field label="Description">
        <input className="field" value={flow.description} onChange={(e) => onEdit((f) => ({ ...f, description: e.target.value }))} />
      </Field>
      <div className="border-t border-line pt-5">
        <VoicePanel agent={flow.agent} onChange={(patch) => onEdit((f) => ({ ...f, agent: { ...f.agent, ...patch } }))} />
      </div>
    </div>
  );
}
