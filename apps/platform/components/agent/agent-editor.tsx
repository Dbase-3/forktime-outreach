"use client";

// One agent, on a split screen (owner 2026-11-26): its setup on the left
// (Config first, then Knowledge, Data, Tools) and on the right two tabs,
// Workflow (canvas or list; a clicked step opens on the left) and
// Preview (talk to it by voice, ElevenLabs-style, or by text). Under the setup
// sits "Change with AI": a blank agent is written whole from a description,
// then every change can be asked for in plain words.

import clsx from "clsx";
import { AlertTriangle, ArrowDown, ArrowLeft, ArrowUp, CheckCircle2, Loader2, MessageSquareText, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { docsForAgent } from "@outreach/core/knowledge";
import { dataSchema } from "@outreach/core/agent-data";
import { BRIEF_MAX } from "@outreach/core/schemas";
import { TOP, allSteps, findStep, flowIssues, insertStep, makeStep, moveStep, removeStep, updateStep, type Container } from "@outreach/core/flow-tree";
import { useQuery } from "@tanstack/react-query";
import type { Contact } from "@outreach/core/types";
import { ApiError, ws } from "@/lib/api";
import { publishAgent, unpublishAgent } from "@/lib/actions";
import { nowIso, update, useApp } from "@/lib/store";
import { humanize } from "@outreach/core/format";
import { businessOf, variableGroups } from "@outreach/core/variables";
import type { Flow, Step } from "@outreach/core/types";
import { FlowCanvas } from "../flow/flow-canvas";
import { metaOf } from "../flow/meta";
import { StepList, type StepListContext } from "../flow/step-list";
import { AddStepSheet, StepForm, decisionFields, type NewStepChoice } from "../flow/step-sheet";
import { Popover } from "../popover";
import { EmptyState, Segmented } from "../ui";
import { draftFields, useAgentWriter } from "./agent-writer";
import { ConfigTab } from "./config-tab";
import { DataTab } from "./data-tab";
import { KnowledgeTab } from "./knowledge-tab";
import { AgentMenu } from "./agent-menu";
import { PreviewPanel } from "./preview-panel";
import { ToolsTab } from "./tools-tab";
import { ChangeWithAi } from "./change-with-ai";
import { SplitDivider, useSplit } from "./split-divider";

type SetupTab = "config" | "knowledge" | "data" | "tools" | "step";
type MainTab = "workflow" | "preview";
type View = "canvas" | "list";

function saveFlow(id: string, fn: (flow: Flow) => Flow): void {
  update((s) => ({ ...s, flows: s.flows.map((f) => (f.id === id ? { ...fn(f), updatedAt: nowIso() } : f)) }));
}

export function AgentEditor({ id }: { id: string }) {
  const app = useApp();
  const router = useRouter();
  const flow = app.flows.find((f) => f.id === id);
  const [setupTab, setSetupTab] = useState<SetupTab>("config");
  const [mainTab, setMainTab] = useState<MainTab>("preview");
  const [phoneSetup, setPhoneSetup] = useState(true); // phones show one pane: setup, or the main tab
  const [split, setSplit] = useSplit(); // the left pane's width in %, dragged with the divider
  const panes = useRef<HTMLDivElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [adding, setAdding] = useState<{ container: Container; index: number } | null>(null);
  const [view, setView] = useState<View>("list");
  // Undo after Write with AI puts back only what the AI wrote, so edits made meanwhile stay (B28).
  const [undo, setUndo] = useState<Partial<Flow> | null>(null);
  const [drawn, setDrawn] = useState(0); // bumps when AI (or undo) replaces the workflow, so the canvas refits
  const [startWith, setStartWith] = useState<string | null>(null); // a description to write the agent from on open
  const [focusBrief, setFocusBrief] = useState(false); // "Start from scratch": the cursor waits in "Change with AI"
  const writer = useAgentWriter();
  // Contacts to try the preview as (a few from the server).
  const sampleContacts = useQuery({ queryKey: ["contacts-sample", app.workspace.id], queryFn: () => ws<Contact[]>("/contacts/sample?limit=30") });
  // Go live / back to draft run on the server (same checks) and say why if refused.
  const [going, setGoing] = useState(false);
  const [goProblem, setGoProblem] = useState<string | null>(null);
  const go = async (fn: () => Promise<unknown>) => {
    setGoing(true);
    setGoProblem(null);
    try {
      await fn();
    } catch (err) {
      const issues = err instanceof ApiError ? (err.details as { issues?: string[] } | undefined)?.issues : undefined;
      setGoProblem(issues?.length ? issues.join(" ") : err instanceof Error ? err.message : "That didn't work.");
    } finally {
      setGoing(false);
    }
  };

  useEffect(() => {
    if (window.matchMedia("(min-width: 768px)").matches) setView("canvas");
    // A freshly written agent opens on its workflow, so the owner sees what was built.
    const params = new URLSearchParams(window.location.search);
    if (params.get("blank") === "1") setFocusBrief(true);
    // From "What should this agent do?": write it from that description now, and drop it from the address
    // (so a reload or a shared link doesn't write it again).
    const described = params.get("describe")?.trim();
    if (described) {
      setStartWith(described);
      params.delete("describe");
      window.history.replaceState(null, "", `${window.location.pathname}${params.size ? `?${params}` : ""}`);
    }
  }, []);

  const showMain = (tab: MainTab) => {
    setMainTab(tab);
    setPhoneSetup(false);
  };
  // A clicked step opens on the left (the wide side) as its own tab; the workflow stays in view.
  const select = useCallback((stepId: string | null) => {
    setSelectedId(stepId);
    if (stepId) {
      setMainTab("workflow");
      setSetupTab("step");
      setPhoneSetup(true);
    } else setSetupTab((t) => (t === "step" ? "config" : t));
  }, []);

  const steps = useMemo(() => flow?.steps ?? [], [flow?.steps]);
  const issues = useMemo(
    () => (flow ? [...(flow.numberId ? [] : [{ message: "Pick a phone number for it to call from and answer on", stepId: undefined as string | undefined, number: true }]), ...flowIssues(flow, [...app.fieldDefs.map((d) => ({ key: d.key, type: d.type })), "name", "phone"], app.integrations.filter((i) => i.connected).map((i) => i.id))] : []),
    [flow, app.fieldDefs, app.integrations],
  );
  const questions = useMemo(() => Object.fromEntries(allSteps(steps).flatMap((s) => (s.kind === "ask" && s.field ? [[s.field, s.question]] : []))), [steps]);
  // Everything the instructions can use: the contact's fields and every answer the workflow saves.
  const vars = useMemo(() => variableGroups(app.fieldDefs, Object.keys(questions).map((key) => ({ key, label: humanize(key) }))), [app.fieldDefs, questions]);
  const ctx: StepListContext = useMemo(
    () => ({
      defs: app.fieldDefs,
      questions,
      selectedId,
      activeId,
      issueIds: new Set(issues.flatMap((i) => (i.stepId ? [i.stepId] : []))),
      onAdd: (container, index) => setAdding({ container, index }),
      onSelect: (sid) => select(sid),
    }),
    [app.fieldDefs, questions, selectedId, activeId, issues, select],
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

  /** A blank agent, written whole from what the owner described. Returns a problem to show, or null. */
  const writeAgent = async (brief: string): Promise<string | null> => {
    const draft = await writer.writeAgent({ brief, business: app.settings.businessName, fields: draftFields(app), connected: app.integrations.filter((i) => i.connected).map((i) => i.id) });
    if (!draft) return writer.lastError() ?? "Couldn't write the agent. Try describing it differently.";
    setSelectedId(null);
    setDrawn((n) => n + 1);
    const { agentName, ...parts } = draft;
    edit((f) => ({ ...f, ...parts, agent: agentName ? { ...f.agent, name: agentName } : f.agent, brief: brief.slice(0, BRIEF_MAX), name: /^(untitled|new) agent$/i.test(f.name.trim()) || !f.name.trim() ? draft.name : f.name, askRequired: {} }));
    showMain("workflow");
    return null;
  };
  /** A change from "Change with AI" (or its Undo): the workflow redraws, the step panel closes. */
  const applyParts = (parts: Partial<Flow>) => {
    setSelectedId(null);
    setDrawn((n) => n + 1);
    edit((f) => ({ ...f, ...parts }));
  };
  const rebuildWorkflow = async () => {
    const newSteps = await writer.rebuildWorkflow({
      brief: flow.brief ?? "",
      business: businessOf(flow, app.settings.businessName),
      fields: draftFields(app),
      connected: app.integrations.filter((i) => i.connected).map((i) => i.id),
      agent: { name: flow.agent.name, prompt: flow.prompt, greeting: flow.greeting, direction: flow.direction },
    });
    if (!newSteps) return;
    const now = app.flows.find((f) => f.id === id) ?? flow;
    setUndo({ steps: now.steps, askRequired: now.askRequired });
    setSelectedId(null);
    setDrawn((n) => n + 1);
    edit((f) => ({ ...f, steps: newSteps, askRequired: {} }));
    showMain("workflow");
  };

  const setupTabs: { id: SetupTab; label: string; count?: number }[] = [
    { id: "config", label: "Config" },
    { id: "knowledge", label: "Knowledge", count: docsForAgent(app, flow).length },
    { id: "data", label: "Data", count: dataSchema(flow).length },
    { id: "tools", label: "Tools", count: flow.tools.length || undefined },
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
          <Popover
            align="end"
            className="w-80"
            trigger={
              <button type="button" className={clsx("h-8 px-2", flow.status === "live" ? "btn-secondary border-amber-500/50 text-amber-800 dark:text-amber-300" : "btn-ghost text-amber-700 dark:text-amber-400")}>
                <AlertTriangle size={15} /> {flow.status === "live" ? `Live with ${issues.length} ${issues.length === 1 ? "problem" : "problems"}` : issues.length}
              </button>
            }
          >
            <div className="mb-1.5 text-sm font-medium">{flow.status === "live" ? "This live agent has problems. Calls may go wrong until they're fixed." : "Fix before going live"}</div>
            <ul className="space-y-1">
              {issues.map((issue, i) => (
                <li key={i}>
                  <button
                    type="button"
                    disabled={!issue.stepId && !("number" in issue)}
                    onClick={() => {
                      if (issue.stepId) select(issue.stepId);
                      else if ("number" in issue) {
                        setSetupTab("config");
                        setPhoneSetup(true);
                        setTimeout(() => document.getElementById("agent-number")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
                      }
                    }} className="w-full rounded-md px-2 py-1.5 text-left text-sm text-fg-2 hover:bg-muted disabled:hover:bg-transparent">{issue.message}</button>
                </li>
              ))}
            </ul>
          </Popover>
        )}
        <AgentMenu flow={flow} afterDelete={() => router.push("/agents")} />
        {flow.status === "live" ? (
          <button type="button" className="btn-secondary h-8 border-emerald-500/40 text-emerald-700 dark:text-emerald-400" disabled={going} onClick={() => void go(() => unpublishAgent(flow.id))} title="Switch back to draft"><CheckCircle2 size={15} /> Live</button>
        ) : (
          <button type="button" className="btn-primary h-8" disabled={issues.length > 0 || going} onClick={() => void go(() => publishAgent(flow.id))}>{going ? "Going live…" : "Go live"}</button>
        )}
      </div>

      {goProblem && (
        <div role="alert" className="flex items-center gap-3 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-800 dark:text-amber-300">
          <span className="flex-1">{goProblem}</span>
          <button type="button" className="text-xs font-medium underline" onClick={() => setGoProblem(null)}>Dismiss</button>
        </div>
      )}

      {/* Phones: one pane at a time */}
      <div className="flex shrink-0 border-b border-line px-3 py-2 md:hidden">
        <Segmented<"setup" | MainTab>
          value={phoneSetup ? "setup" : mainTab}
          onChange={(v) => (v === "setup" ? setPhoneSetup(true) : showMain(v))}
          options={[{ value: "setup", label: "Setup" }, { value: "workflow", label: "Workflow" }, { value: "preview", label: "Preview" }]}
        />
      </div>

      <div ref={panes} className="flex min-h-0 flex-1" style={{ "--split": `${split}%` } as CSSProperties}>
        {/* Left: the agent's setup (its width set by the divider from tablet up) */}
        <aside className={clsx("flex w-full min-w-0 flex-col bg-surface md:w-auto md:flex-none md:basis-[var(--split)]", !phoneSetup && "max-md:hidden")}>
          <TabBar
            tabs={setupTabs}
            value={setupTab}
            onChange={(t) => {
              if (t !== "step") setSelectedId(null);
              setSetupTab(t);
            }}
          />
          <div className="min-h-0 flex-1 overflow-y-auto">
            {setupTab === "config" && (
              <ConfigTab
                flow={flow}
                onEdit={edit}
                vars={vars}
                busy={writer.busy}
                error={writer.busy === null && writer.mode === "workflow" ? writer.error : null}
                onRebuild={rebuildWorkflow}
                canUndo={undo !== null}
                onUndo={() => {
                  if (undo) edit((f) => ({ ...f, ...undo }));
                  setDrawn((n) => n + 1);
                  setUndo(null);
                  setSelectedId(null);
                }}
                onDismissUndo={() => setUndo(null)}
              />
            )}
            {setupTab === "knowledge" && <KnowledgeTab flow={flow} />}
            {setupTab === "data" && <DataTab flow={flow} onEdit={edit} />}
            {setupTab === "tools" && <ToolsTab flow={flow} app={app} onEdit={edit} />}
            {setupTab === "step" && selected && (
              <StepPanel
                step={selected}
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
          <ChangeWithAi flow={flow} onApply={applyParts} onWriteWhole={writeAgent} writing={writer.busy === "agent"} focus={focusBrief} startWith={startWith} />
        </aside>

        <SplitDivider container={panes} pct={split} onChange={setSplit} />

        {/* Right: Workflow | Preview */}
        <section className={clsx("flex min-w-0 flex-1 flex-col lg:min-w-[320px]", phoneSetup && "max-md:hidden")}>
          <div className="flex shrink-0 items-center gap-3 border-b border-line pr-3 max-md:hidden">
            <TabBar tabs={[{ id: "workflow", label: "Workflow", count: allSteps(flow.steps).length }, { id: "preview", label: "Preview" }]} value={mainTab} onChange={setMainTab} bare />
            {mainTab === "workflow" && (
              <div className="ml-auto">
                <Segmented<View> value={view} onChange={setView} options={[{ value: "canvas", label: "Canvas" }, { value: "list", label: "List" }]} />
              </div>
            )}
          </div>

          <div className="relative min-h-0 flex-1">
            {/* Workflow (stays mounted under Preview so the canvas keeps its place) */}
            <div className={clsx("absolute inset-0", mainTab !== "workflow" && "invisible")}>
              {view === "canvas" ? (
                <FlowCanvas
                  key={drawn}
                  steps={flow.steps}
                  greeting={flow.greeting}
                  ctx={ctx}
                  onAddAt={(at) => setAdding(at)}
                  onEditGreeting={() => {
                    setSetupTab("config");
                    setPhoneSetup(true);
                  }}
                />
              ) : (
                <div className="h-full overflow-y-auto px-4 pb-10 pt-4">
                  <div className="mx-auto max-w-2xl">
                    <StepList steps={flow.steps} container={TOP} depth={0} ctx={ctx} />
                  </div>
                </div>
              )}
              {writer.busy && (
                <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-background/70 backdrop-blur-[2px]">
                  <Loader2 size={20} className="animate-spin text-fg-3" />
                  <span className="text-sm text-fg-2">{writer.busy === "agent" ? "Writing your agent…" : "Rebuilding the workflow…"}</span>
                </div>
              )}
            </div>

            {/* Preview (stays mounted so a call carries on while you look at the workflow) */}
            <div className={clsx("absolute inset-0 bg-background", mainTab !== "preview" && "invisible")}>
              <PreviewPanel flow={flow} business={businessOf(flow, app.settings.businessName)} contacts={sampleContacts.data ?? []} onActiveStep={setActiveId} />
            </div>
          </div>
        </section>
      </div>

      <AddStepSheet open={adding !== null} onClose={() => setAdding(null)} onPick={pick} />
    </div>
  );
}

function TabBar<T extends string>({ tabs, value, onChange, bare }: { tabs: { id: T; label: string; count?: number }[]; value: T; onChange: (t: T) => void; bare?: boolean }) {
  return (
    <div className={clsx("flex shrink-0 gap-4 overflow-x-auto px-4", !bare && "border-b border-line")} role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={clsx("-mb-px shrink-0 border-b-2 py-3 text-sm font-medium transition-colors", value === t.id ? "border-fg text-fg" : "border-transparent text-fg-3 hover:text-fg")}
        >
          {t.label}
          {t.count !== undefined && <span className="ml-1 font-mono text-xs text-fg-4">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

function StepPanel({ step, fields, onChange, onMove, onDelete, onClose }: { step: Step; fields: ReturnType<typeof decisionFields>; onChange: (p: Partial<Step>) => void; onMove: (d: -1 | 1) => void; onDelete: () => void; onClose: () => void }) {
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
