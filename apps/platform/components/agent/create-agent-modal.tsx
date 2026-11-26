"use client";

// Before a new agent opens (owner 2026-11-26): name it (a random starter name,
// only to tell agents apart; what it says on calls is set in Config) and pick
// its phone number. A number already used by another agent can't be taken;
// "Get another number" adds one without leaving the dialog.

import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { numberOwner, randomAgentName } from "@outreach/core/numbers";
import { update, useApp } from "@/lib/store";
import { flowFromTemplate, type FlowTemplate } from "@outreach/core/templates";
import { Field, Modal } from "../ui";
import { GetNumber, NumberPicker } from "../numbers/number-picker";

export function CreateAgentModal({ open, template, onClose }: { open: boolean; template: FlowTemplate | null; onClose: () => void }) {
  const app = useApp();
  const router = useRouter();
  const [name, setName] = useState("");
  const [numberId, setNumberId] = useState<string | undefined>(undefined);
  const [view, setView] = useState<"details" | "number">("details");
  const nameBox = useRef<HTMLInputElement>(null);

  // Fresh each time it opens: a starter name, and the first free number picked for them.
  useEffect(() => {
    if (!open) return;
    const taken = app.flows.map((f) => f.name);
    setName(template && !taken.includes(template.name) ? template.name : randomAgentName(taken));
    setNumberId(app.numbers.find((n) => !numberOwner(app.flows, n.id))?.id);
    setView("details");
    // Only when it opens; later edits to the workspace shouldn't reset what they typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, template]);

  const blocked = Boolean(numberOwner(app.flows, numberId));
  const create = () => {
    if (!name.trim() || blocked) return;
    const flow = { ...flowFromTemplate(template, new Date(), app.settings.timezone), name: name.trim(), numberId };
    update((s) => ({ ...s, flows: [flow, ...s.flows] }));
    onClose();
    router.push(template ? `/agents/${flow.id}` : `/agents/${flow.id}?blank=1`);
  };

  if (view === "number") {
    return (
      <Modal open={open} onClose={onClose} title="Get another number" description="Pick where people will see you calling from.">
        <button type="button" className="mb-3 flex items-center gap-1 text-sm text-fg-3 hover:text-fg" onClick={() => setView("details")}><ArrowLeft size={14} /> Back</button>
        <GetNumber
          taken={app.numbers.map((n) => n.e164)}
          onAdded={(n) => {
            setNumberId(n.id);
            setView("details");
          }}
        />
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={template ? `New agent from “${template.name}”` : "New agent"}
      description="Name it and give it a number. You can change both later."
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" onClick={create} disabled={!name.trim() || blocked}>Create agent</button>
        </div>
      }
    >
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          create();
        }}
      >
        <Field label="Agent name" hint="Only for you, to tell your agents apart. What it calls itself on calls is set in Config.">
          <input ref={nameBox} className="field" value={name} onChange={(e) => setName(e.target.value)} onFocus={(e) => e.target.select()} autoFocus maxLength={60} />
        </Field>
        <div>
          <span className="label">Phone number</span>
          <p className="-mt-0.5 mb-2 text-xs text-fg-3">It makes and answers calls on this number. Each number belongs to one agent.</p>
          <NumberPicker numbers={app.numbers} flows={app.flows} value={numberId} onChange={setNumberId} onGetNumber={() => setView("number")} />
        </div>
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  );
}
