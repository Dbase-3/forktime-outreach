"use client";

// Choosing an agent's phone number, and getting another one. A number belongs
// to one agent: picking one that's taken shows who has it and offers a new
// number instead (owner 2026-11-26). "Decide later" never blocks anyone.

import clsx from "clsx";
import { AlertTriangle, Check, Phone, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { COUNTRIES, KIND_LABEL, availableNumbers, countryOf, numberOwner, type NumberKind, type Offer } from "@/lib/numbers";
import { newId } from "@/lib/flow-tree";
import { nowIso, update } from "@/lib/store";
import type { Flow, PhoneNumber } from "@/lib/types";
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
  const pick = onChange;

  return (
    <div className="space-y-2">
      <div className="divide-y divide-line overflow-hidden rounded-xl border border-line" role="radiogroup" aria-label="Phone number">
        {numbers.map((n) => {
          const owner = numberOwner(flows, n.id, exceptFlowId);
          const selected = value === n.id;
          return (
            <button
              key={n.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => pick(n.id)}
              className={clsx("flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors", selected ? (owner ? "bg-amber-500/[0.07]" : "bg-accent/[0.06]") : "hover:bg-subtle")}
            >
              <Radio on={selected} warn={Boolean(owner)} />
              <span className="min-w-0 flex-1">
                <span className="block font-mono text-sm font-medium">{n.display}</span>
                <span className="block text-xs text-fg-3">{describeNumber(n)}</span>
              </span>
              {owner ? (
                <span className="shrink-0 truncate text-xs text-fg-3">Used by <span className="font-medium text-fg-2">{owner.name}</span></span>
              ) : (
                <span className="shrink-0 text-xs font-medium text-emerald-700 dark:text-emerald-400">Free</span>
              )}
            </button>
          );
        })}
        <button type="button" role="radio" aria-checked={!value} onClick={() => pick(undefined)} className={clsx("flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors", !value ? "bg-accent/[0.06]" : "hover:bg-subtle")}>
          <Radio on={!value} />
          <span className="flex-1 text-sm text-fg-2">Decide later</span>
          <span className="text-xs text-fg-3">Needed before it goes live</span>
        </button>
      </div>

      {blockedBy && (
        <div className="flex gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/[0.07] p-3" role="alert">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-700 dark:text-amber-400" />
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-medium">This number belongs to {blockedBy.name}</p>
            <p className="mt-0.5 text-fg-2">A number can answer for one agent only. Get another number for this one, or pick a free number above.</p>
            <button type="button" className="btn-primary mt-2.5 h-8" onClick={onGetNumber}><Plus size={14} /> Get another number</button>
          </div>
        </div>
      )}
      {!blockedBy && (
        <button type="button" onClick={onGetNumber} className="flex items-center gap-1.5 rounded-md px-1 py-1 text-sm font-medium text-fg-2 hover:text-fg">
          <Plus size={14} /> Get another number
        </button>
      )}
    </div>
  );
}

function Radio({ on, warn }: { on: boolean; warn?: boolean }) {
  return (
    <span className={clsx("flex h-4 w-4 shrink-0 items-center justify-center rounded-full border", on ? (warn ? "border-amber-600 bg-amber-600" : "border-accent bg-accent") : "border-line-strong")} aria-hidden>
      {on && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
    </span>
  );
}

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
