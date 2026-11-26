"use client";

// The agent's setup, first tab on the left: its instructions (persona, tone,
// rules), the welcome line, direction, time zone, number and voice. The steps
// live in the workflow. Writing or changing it with AI is the "Change with AI"
// box under the setup (change-with-ai.tsx).

import { Loader2, Undo2, Workflow, X } from "lucide-react";
import { useMemo, useState } from "react";
import { allTimezones, offsetLabel, timeIn, zoneName } from "@outreach/core/timezones";
import type { Direction, Flow } from "@outreach/core/types";
import type { VarGroup } from "@outreach/core/variables";
import { numberOwner } from "@outreach/core/numbers";
import { setAgentNumber } from "@/lib/actions";
import { useApp } from "@/lib/store";
import { VoicePanel } from "../flow/voice-panel";
import { GetNumber, NumberPicker } from "../numbers/number-picker";
import { VarText } from "../var-text";
import { Popover } from "../popover";
import { Confirm } from "../confirm";
import { Field, Modal, Segmented } from "../ui";

export function ConfigTab({
  flow,
  onEdit,
  vars,
  busy,
  error,
  onRebuild,
  canUndo,
  onUndo,
  onDismissUndo,
}: {
  flow: Flow;
  onEdit: (fn: (f: Flow) => Flow) => void;
  vars: VarGroup[];
  busy: null | "agent" | "workflow";
  error: string | null;
  onRebuild: () => void;
  canUndo: boolean;
  onUndo: () => void;
  onDismissUndo: () => void;
}) {
  const hasWork = flow.steps.length > 0;

  return (
    <div className="space-y-6 p-4">
      <Field label="Description" hint="One line, shown in the agents list.">
        <input className="field" value={flow.description} onChange={(e) => onEdit((f) => ({ ...f, description: e.target.value }))} placeholder="What this agent is for" />
      </Field>

      {/* Instructions */}
      <div>
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span className="label mb-0">Instructions</span>
          <Confirm
            skip={!hasWork}
            title="Rebuild the workflow?"
            body="The steps are redrawn from these instructions and the description. You can undo."
            action="Rebuild"
            onConfirm={onRebuild}
            trigger={
              <button type="button" className="btn-ghost h-7 px-2 text-xs" disabled={busy !== null || !flow.prompt.trim()}>
                {busy === "workflow" ? <Loader2 size={13} className="animate-spin" /> : <Workflow size={13} />}
                {busy === "workflow" ? "Rebuilding…" : "Rebuild workflow"}
              </button>
            }
          />
        </div>
        <div className="relative">
          <VarText
            className="field min-h-60 text-sm leading-relaxed"
            value={flow.prompt}
            onChange={(prompt) => onEdit((f) => ({ ...f, prompt }))}
            groups={vars}
            placeholder="Who the agent is, its tone, and the rules it follows."
            disabled={busy === "agent"}
            aria-label="Instructions"
          />
          {busy === "agent" && <Shimmer />}
        </div>
        <p className="mt-1 text-xs text-fg-3">Who it is, how it sounds and its rules. The steps it follows are in the Workflow.</p>
        {error && <p className="mt-2 text-xs text-rose-700 dark:text-rose-400">{error}</p>}
        {canUndo && !busy && (
          <div className="mt-2 flex items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs text-fg-2">
            <span className="flex-1">Workflow rebuilt by AI. Check it and try it in Preview.</span>
            <button type="button" className="btn-ghost h-7 px-2 text-xs" onClick={onUndo}><Undo2 size={13} /> Undo</button>
            <button type="button" className="btn-icon h-7 w-7" onClick={onDismissUndo} aria-label="Dismiss"><X size={13} /></button>
          </div>
        )}
      </div>

      <Field label="Welcome message" hint="Keep “AI assistant” and “recorded” in it: callers must be told.">
        <div className="relative">
          <VarText className="field min-h-20 leading-relaxed" value={flow.greeting} onChange={(greeting) => onEdit((f) => ({ ...f, greeting }))} groups={vars.filter((g) => g.title !== "Answers on this call")} disabled={busy === "agent"} aria-label="Welcome message" />
          {busy === "agent" && <Shimmer />}
        </div>
      </Field>

      <div className="grid gap-4 xl:grid-cols-2">
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
        <TimezoneField value={flow.timezone} onChange={(timezone) => onEdit((f) => ({ ...f, timezone }))} />
      </div>

      <div id="agent-number" className="border-t border-line pt-5">
        <h3 className="eyebrow mb-1">Phone number</h3>
        <p className="mb-3 text-xs text-fg-3">It makes and answers calls on this number. Each number belongs to one agent.</p>
        <NumberField flow={flow} onEdit={onEdit} />
      </div>

      <div className="border-t border-line pt-5">
        <h3 className="eyebrow mb-3">Voice</h3>
        <VoicePanel agent={flow.agent} onChange={(patch) => onEdit((f) => ({ ...f, agent: { ...f.agent, ...patch } }))} />
      </div>

    </div>
  );
}

/** The agent's number. A taken one can be clicked (to see who has it) but is never saved. */
function NumberField({ flow, onEdit }: { flow: Flow; onEdit: (fn: (f: Flow) => Flow) => void }) {
  const app = useApp();
  const [pending, setPending] = useState<string | null>(null);
  const [getting, setGetting] = useState(false);
  const [liveNote, setLiveNote] = useState(false);
  const [numberProblem, setNumberProblem] = useState<string | null>(null);
  return (
    <>
      <NumberPicker
        numbers={app.numbers}
        flows={app.flows}
        exceptFlowId={flow.id}
        value={pending ?? flow.numberId}
        onChange={(id) => {
          if (id && numberOwner(app.flows, id, flow.id)) {
            setPending(id);
            return;
          }
          if (!id && flow.status === "live") {
            setLiveNote(true);
            return;
          }
          setLiveNote(false);
          setPending(null);
          onEdit((f) => ({ ...f, numberId: id }));
        }}
        onGetNumber={() => setGetting(true)}
      />
      {liveNote && <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">A live agent needs a number. Switch it to draft first, or pick another number.</p>}
      {numberProblem && <p className="mt-2 text-xs text-rose-700 dark:text-rose-400">{numberProblem}</p>}
      <Modal open={getting} onClose={() => setGetting(false)} title="Get another number" description="Pick where people will see you calling from.">
        <GetNumber
          taken={app.numbers.map((n) => n.e164)}
          onAdded={(n) => {
            setPending(null);
            void setAgentNumber(flow.id, n.id).catch((err) => setNumberProblem(err instanceof Error ? err.message : "Couldn't change the number."));
            setGetting(false);
          }}
        />
      </Modal>
    </>
  );
}

function Shimmer() {
  return <div className="skeleton pointer-events-none absolute inset-0 rounded-lg opacity-80" aria-hidden />;
}

function TimezoneField({ value, onChange }: { value: string; onChange: (zone: string) => void }) {
  const zones = useMemo(() => allTimezones(), []);
  const list = zones.includes(value) ? zones : [value, ...zones];
  return (
    <Field label="Time zone" hint={`It's ${timeIn(value)} there now. “Today”, opening hours and booking times are read in this zone.`}>
      <select className="field" value={value} onChange={(e) => onChange(e.target.value)}>
        {list.map((z) => (
          <option key={z} value={z}>{zoneName(z)} · {offsetLabel(z)}</option>
        ))}
      </select>
    </Field>
  );
}

