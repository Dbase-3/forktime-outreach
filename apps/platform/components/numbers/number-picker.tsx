"use client";

// Choosing an agent's phone number, and getting another one. A number belongs
// to one agent: picking one that's taken shows who has it and offers a new
// number instead (owner 2026-11-26). "Decide later" never blocks anyone.

import clsx from "clsx";
import { AlertTriangle, Check, Phone, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { COUNTRIES, KIND_LABEL, availableNumbers, countryOf, numberOwner, type NumberKind, type Offer } from "@outreach/core/numbers";
import { newId } from "@outreach/core/flow-tree";
import { nowIso, update } from "@/lib/store";
import type { Flow, PhoneNumber } from "@outreach/core/types";
import { Segmented } from "../ui";

export function describeNumber(n: PhoneNumber): string {
  return `${KIND_LABEL[n.kind]} · ${countryOf(n.country).label}`;
}

/** Adds a number to the workspace and returns it. */
export function addNumber(offer: Offer): PhoneNumber {
  const number: PhoneNumber = { id: newId("n"), e164: offer.e164, display: offer.display, country: offer.country, kind: offer.kind, ...(offer.area ? { area: offer.area } : {}), addedAt: nowIso() };
  update((s) => ({ ...s, numbers: [...s.numbers, number] }));
  return number;
}

export function NumberPicker({
  numbers,
  flows,
  value,
  onChange,
  exceptFlowId,
  onGetNumber,
}: {
  numbers: PhoneNumber[];
  flows: Pick<Flow, "id" | "name" | "numberId">[];
  value: string | undefined;
  onChange: (numberId: string | undefined) => void;
  exceptFlowId?: string;
  onGetNumber: () => void;
}) {
  // The parent holds the choice; a taken number can be chosen (to see who has it) but not saved.
  const blockedBy = numberOwner(flows, value, exceptFlowId);
  const free = numbers.filter((n) => !numberOwner(flows, n.id, exceptFlowId));
  const taken = numbers.filter((n) => numberOwner(flows, n.id, exceptFlowId));
  const current = numbers.find((n) => n.id === value);

  return (
    <div className="space-y-2">
      <select
        className={clsx("field font-mono", blockedBy && "border-amber-500/60")}
        value={value ?? ""}
        aria-label="Phone number"
        onChange={(e) => {
          if (e.target.value === NEW) {
            onGetNumber();
            return;
          }
          onChange(e.target.value || undefined);
        }}
      >
        <option value="">Decide later</option>
        {free.length > 0 && (
          <optgroup label="Free">
            {free.map((n) => <option key={n.id} value={n.id}>{n.display} · {describeNumber(n)}</option>)}
          </optgroup>
        )}
        {taken.length > 0 && (
          <optgroup label="Used by another agent">
            {taken.map((n) => <option key={n.id} value={n.id}>{n.display} · used by {numberOwner(flows, n.id, exceptFlowId)?.name}</option>)}
          </optgroup>
        )}
        <option value={NEW}>+ Get another number…</option>
      </select>

      {blockedBy ? (
        <div className="flex gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/[0.07] p-3" role="alert">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-700 dark:text-amber-400" />
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-medium">This number belongs to {blockedBy.name}</p>
            <p className="mt-0.5 text-fg-2">A number can answer for one agent only. Get another number for this one, or pick a free one.</p>
            <button type="button" className="btn-primary mt-2.5 h-8" onClick={onGetNumber}><Plus size={14} /> Get another number</button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="text-fg-3">{current ? "" : "It needs a number before it goes live."}</span>
          <button type="button" onClick={onGetNumber} className="flex items-center gap-1 font-medium text-fg-2 hover:text-fg">
            <Plus size={13} /> Get another number
          </button>
        </div>
      )}
    </div>
  );
}

const NEW = "__new";

/** Search for a number by country, type and area, and add one. */
export function GetNumber({ taken, onAdded, defaultCountry = "AU" }: { taken: string[]; onAdded: (n: PhoneNumber) => void; defaultCountry?: string }) {
  const [country, setCountry] = useState(defaultCountry);
  const c = countryOf(country);
  const [kind, setKind] = useState<NumberKind>("local");
  const [area, setArea] = useState(c.areas[0].id);
  const offers = availableNumbers(country, kind, area, taken);
  const [added, setAdded] = useState<string | null>(null);

  const changeCountry = (code: string) => {
    const next = countryOf(code);
    setCountry(code);
    setArea(next.areas[0].id);
    if (!next.kinds.includes(kind)) setKind(next.kinds[0]);
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="label">Country</span>
          <select className="field" value={country} onChange={(e) => changeCountry(e.target.value)}>
            {COUNTRIES.map((x) => <option key={x.code} value={x.code}>{x.label}</option>)}
          </select>
        </label>
        <label className={clsx("block", kind !== "local" && "opacity-50")}>
          <span className="label">Area</span>
          <select className="field" value={area} onChange={(e) => setArea(e.target.value)} disabled={kind !== "local"}>
            {c.areas.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
          </select>
        </label>
      </div>
      <div>
        <span className="label">Type</span>
        <Segmented<NumberKind> value={kind} onChange={setKind} options={c.kinds.map((k) => ({ value: k, label: KIND_LABEL[k] }))} />
        <p className="mt-1.5 text-xs text-fg-3">{kind === "local" ? "Looks local to the people you call. Best for most businesses." : kind === "mobile" ? "Can also send and receive texts in more places." : "Free for callers to ring. Good for answering lines."}</p>
      </div>
      <div>
        <span className="label">Available now</span>
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
          {offers.map((o) => (
            <li key={o.e164} className="flex items-center gap-3 px-3 py-2.5">
              <Phone size={14} className="shrink-0 text-fg-4" />
              <span className="flex-1 font-mono text-sm">{o.display}</span>
              <button
                type="button"
                className="btn-secondary h-8 px-3 text-sm"
                disabled={added !== null}
                onClick={() => {
                  setAdded(o.e164);
                  onAdded(addNumber(o));
                }}
              >
                {added === o.e164 ? <><Check size={14} /> Added</> : "Add"}
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-1.5 text-xs text-fg-3">Numbers are added to your workspace straight away. You can see them all on <Link href="/numbers" className="underline hover:text-fg">Numbers</Link>.</p>
      </div>
    </div>
  );
}
