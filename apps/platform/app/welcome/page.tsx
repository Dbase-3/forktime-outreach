"use client";

// First run: name the workspace (the business) and its time zone. It starts
// empty (owner 2026-11-27: no sample-data choice here).

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ApiError, request } from "@/lib/api";
import { boot } from "@/lib/store";
import { allTimezones, offsetLabel, zoneName } from "@outreach/core/timezones";
import { AuthCard } from "@/components/auth-card";

export default function WelcomePage() {
  const router = useRouter();
  const zones = useMemo(() => allTimezones(), []);
  const guess = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "Australia/Sydney";
  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState(zones.includes(guess) ? guess : "Australia/Sydney");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const { id } = await request<{ id: string }>("/workspaces", { body: { name: name.trim(), timezone, sample: false } });
      await boot(id); // loaded (and remembered) before the dashboard shows, so it never bounces back here
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
        <button type="submit" className="btn-primary w-full" disabled={busy || !name.trim()}>
          {busy && <Loader2 size={15} className="animate-spin" />} Create workspace
        </button>
        {error && <p className="text-sm text-rose-700 dark:text-rose-400" role="alert">{error}</p>}
      </form>
    </AuthCard>
  );
}
