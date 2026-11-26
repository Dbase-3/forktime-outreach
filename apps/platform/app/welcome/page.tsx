"use client";

// First run: name the workspace (the business), its time zone, and whether to
// start with the sample (demo agents, contacts, campaigns and calls).

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ApiError, request } from "@/lib/api";
import { allTimezones, offsetLabel, zoneName } from "@outreach/core/timezones";
import { AuthCard } from "@/components/auth-card";
import { Toggle } from "@/components/ui";

export default function WelcomePage() {
  const router = useRouter();
  const zones = useMemo(() => allTimezones(), []);
  const guess = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "Australia/Sydney";
  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState(zones.includes(guess) ? guess : "Australia/Sydney");
  const [sample, setSample] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const { id } = await request<{ id: string }>("/workspaces", { body: { name: name.trim(), timezone, sample } });
      try {
        window.localStorage.setItem("forktime.workspace", id);
      } catch {
        // fine
      }
      router.replace("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't create the workspace.");
      setBusy(false);
    }
  };

  return (
    <AuthCard title="Set up your workspace" subtitle="Your business's agents, numbers, contacts and campaigns live here. You can invite your team later.">
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void create(); }}>
        <label className="block">
          <span className="label">Business name</span>
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="Northside Motors" autoFocus required maxLength={120} />
        </label>
        <label className="block">
          <span className="label">Time zone</span>
          <select className="field" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
            {zones.map((z) => <option key={z} value={z}>{zoneName(z)} · {offsetLabel(z)}</option>)}
          </select>
        </label>
        <div className="flex items-start justify-between gap-3 rounded-xl border border-line p-3">
          <span>
            <span className="block text-sm font-medium">Start with sample data</span>
            <span className="block text-xs text-fg-3">Three demo agents, contacts, campaigns and calls to explore. Delete them any time.</span>
          </span>
          <Toggle checked={sample} onChange={setSample} label="Start with sample data" />
        </div>
        <button type="submit" className="btn-primary w-full" disabled={busy || !name.trim()}>
          {busy && <Loader2 size={15} className="animate-spin" />} Create workspace
        </button>
        {error && <p className="text-sm text-rose-700 dark:text-rose-400" role="alert">{error}</p>}
      </form>
    </AuthCard>
  );
}
