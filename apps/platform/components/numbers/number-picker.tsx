"use client";

// Choosing an agent's phone number. A number belongs to one agent: picking one
// that's taken shows who has it (owner 2026-11-26). "Decide later" never blocks
// anyone. For now every workspace has one real number, the shared Lisna line
// (outbound only), and numbers can't be bought (owner 2026-11-28): the old
// made-up sample numbers are listed apart, as samples that can't call.

import clsx from "clsx";
import { AlertTriangle, Check, Phone, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { COUNTRIES, KIND_LABEL, countryOf, numberOwner, type NumberKind } from "@outreach/core/numbers";
import { addNumber, searchNumbers } from "@/lib/actions";
import type { Flow, PhoneNumber } from "@outreach/core/types";
import { Segmented } from "../ui";

export function describeNumber(n: PhoneNumber): string {
  if (n.shared) return "Lisna line · makes calls, doesn't take them yet";
  if (n.sample) return "Sample number · can't call";
  return `${KIND_LABEL[n.kind]} · ${countryOf(n.country).label}`;
}

/** Real numbers first (the Lisna line on top), samples last. */
export const byUse = (a: PhoneNumber, b: PhoneNumber) => Number(Boolean(b.shared)) - Number(Boolean(a.shared)) || Number(Boolean(a.sample)) - Number(Boolean(b.sample));


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
  /** Unused while numbers can't be bought (kept so callers don't change). */
  onGetNumber?: () => void;
}) {
  // The parent holds the choice; a taken number can be chosen (to see who has it) but not saved.
  const blockedBy = numberOwner(flows, value, exceptFlowId);
  const real = numbers.filter((n) => !n.sample).sort(byUse);
  const samples = numbers.filter((n) => n.sample);
  const free = real.filter((n) => !numberOwner(flows, n.id, exceptFlowId));
  const taken = real.filter((n) => numberOwner(flows, n.id, exceptFlowId));
  const current = numbers.find((n) => n.id === value);

  return (
    <div className="space-y-2">
      <select
        className={clsx("field font-mono", blockedBy && "border-amber-500/60")}
        value={value ?? ""}
        aria-label="Phone number"
        onChange={(e) => {
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
        {samples.length > 0 && (
          <optgroup label="Samples (can't call)">
            {samples.map((n) => <option key={n.id} value={n.id}>{n.display}{numberOwner(flows, n.id, exceptFlowId) ? ` · used by ${numberOwner(flows, n.id, exceptFlowId)?.name}` : ""}</option>)}
          </optgroup>
        )}
      </select>

      {blockedBy ? (
        <div className="flex gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/[0.07] p-3" role="alert">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-700 dark:text-amber-400" />
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-medium">This number belongs to {blockedBy.name}</p>
            <p className="mt-0.5 text-fg-2">One agent at a time uses a number. To use it here, first set {blockedBy.name}&apos;s number to Decide later in its Config.</p>
            <Link href={`/agents/${blockedBy.id}`} className="btn-secondary mt-2.5 h-8">Open {blockedBy.name}</Link>
          </div>
        </div>
      ) : (
        <p className="text-xs text-fg-3">
          {current?.shared
            ? "It calls from the Lisna line. Calls to this number aren't answered yet."
            : current?.sample
              ? "A sample number can't call. Pick the Lisna line to make real calls."
              : "It needs a number before it goes live. Pick the Lisna line to make real calls."}
        </p>
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
  // The server offers numbers (fictional ranges until Phase 3) and skips ones anyone has.
  const offersQuery = useQuery({ queryKey: ["number-offers", country, kind, kind === "local" ? area : ""], queryFn: () => searchNumbers(country, kind, kind === "local" ? area : "") });
  const offers = offersQuery.data ?? [];
  const [problem, setProblem] = useState<string | null>(null);
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
          {offersQuery.isLoading && Array.from({ length: 3 }, (_, i) => <li key={i} className="px-3 py-3"><span className="skeleton block h-4 w-36 rounded" /></li>)}
          {offers.map((o) => (
            <li key={o.e164} className="flex items-center gap-3 px-3 py-2.5">
              <Phone size={14} className="shrink-0 text-fg-4" />
              <span className="flex-1 font-mono text-sm">{o.display}</span>
              <button
                type="button"
                className="btn-secondary h-8 px-3 text-sm"
                disabled={added !== null}
                onClick={async () => {
                  setAdded(o.e164);
                  setProblem(null);
                  try {
                    onAdded(await addNumber(o));
                  } catch (err) {
                    setAdded(null);
                    setProblem(err instanceof Error ? err.message : "Couldn't add it.");
                    void offersQuery.refetch();
                  }
                }}
              >
                {added === o.e164 ? <><Check size={14} /> Added</> : "Add"}
              </button>
            </li>
          ))}
        </ul>
        {problem && <p className="mt-1.5 text-xs text-rose-700 dark:text-rose-400">{problem}</p>}
        <p className="mt-1.5 text-xs text-fg-3">Numbers are added to your workspace straight away. You can see them all on <Link href="/numbers" className="underline hover:text-fg">Numbers</Link>.</p>
      </div>
    </div>
  );
}
