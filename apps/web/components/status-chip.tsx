import clsx from "clsx";
import { OUTCOME_INFO } from "@/lib/outcomes";
import { liveLabel } from "@/lib/format";
import type { CallJson } from "@/lib/types";

const TONES = {
  good: "border-emerald-200 bg-emerald-50 text-emerald-800",
  neutral: "border-gray-200 bg-gray-50 text-gray-700",
  warn: "border-amber-200 bg-amber-50 text-amber-800",
  bad: "border-red-200 bg-red-50 text-red-800",
  live: "border-emerald-300 bg-white text-emerald-800",
} as const;

/** One call's state in a couple of words: what it is doing now, or how it ended. */
export function StatusChip({ call, repFirstName }: { call: CallJson; repFirstName: string }) {
  const live = call.status === "dialing" || call.status === "live";
  const outcome = call.outcome ? OUTCOME_INFO[call.outcome] : null;
  const tone = live ? "live" : (outcome?.tone ?? "neutral");
  const label = live || !outcome ? liveLabel(call, repFirstName) : outcome.label;

  return (
    <span className={clsx("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium", TONES[tone])}>
      {live && (
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
        </span>
      )}
      {label}
    </span>
  );
}
