"use client";

// Integration logo and the connect drawer, shared by the Integrations page and
// anywhere else a tool is offered (Contacts → Sources, an agent's steps).

import clsx from "clsx";
import { Check, Loader2, Webhook } from "lucide-react";
import { useEffect, useState } from "react";
import { CATEGORIES, integrationInfo, logoUrl, type IntegrationInfo } from "@outreach/core/integrations";
import { connectIntegration, connectWithKey, disconnectIntegration, eventTypesOf, setEventType, type EventTypeOption } from "@/lib/actions";
import { ApiError } from "@/lib/api";
import { useApp } from "@/lib/store";
import { Sheet } from "./ui";

export function IntegrationLogo({ info, size = "md" }: { info: IntegrationInfo; size?: "sm" | "md" | "lg" }) {
  const url = logoUrl(info);
  const box = { sm: "h-6 w-6 rounded-md", md: "h-9 w-9 rounded-lg", lg: "h-12 w-12 rounded-xl" }[size];
  const px = { sm: 14, md: 20, lg: 28 }[size];
  return (
    <span className={clsx("flex shrink-0 items-center justify-center border border-line bg-white", box)}>
      {url ? (
        // Favicons from Google's service (as the Forktime dashboard does for booking systems).
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" width={px} height={px} className="rounded-sm" loading="lazy" />
      ) : (
        <Webhook size={px - 2} className="text-zinc-700" />
      )}
    </span>
  );
}

export function ConnectSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { integrations } = useApp();
  const info = id ? integrationInfo(id) : undefined;
  const conn = info ? integrations.find((i) => i.id === info.id && i.connected) : undefined;
  const [account, setAccount] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => (setApiKey(""), setError("")), [id]);
  const connect = async () => {
    if (!info) return;
    if (!info.apiKey) {
      void connectIntegration(info.id, account.trim() || `${info.name} account`);
      setAccount("");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await connectWithKey(info.id, apiKey.trim());
      setApiKey("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Couldn't reach ${info.name}. Try again.`);
    } finally {
      setBusy(false);
    }
  };
  const disconnect = () => info && void disconnectIntegration(info.id);

  return (
    <Sheet
      open={Boolean(id)}
      onClose={onClose}
      title={info?.name ?? ""}
      footer={
        info &&
        (conn ? (
          <button type="button" className="btn-ghost w-full text-rose-600 hover:bg-rose-500/10" onClick={disconnect}>Disconnect</button>
        ) : (
          <button type="button" className="btn-primary w-full" onClick={() => void connect()} disabled={busy || (Boolean(info.apiKey) && apiKey.trim().length < 8)}>
            {busy ? (
              <>
                <Loader2 size={15} className="animate-spin" /> Checking the key…
              </>
            ) : (
              <>Connect {info.name}</>
            )}
          </button>
        ))
      }
    >
      {info && (
        <div className="space-y-5">
          <div className="flex items-center gap-3">
            <IntegrationLogo info={info} size="lg" />
            <div>
              <div className="font-medium">{info.name}</div>
              <div className="text-sm text-fg-3">{CATEGORIES.find((c) => c.id === info.category)?.label}</div>
            </div>
          </div>
          {conn && (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-800 dark:text-emerald-300">
              <Check size={15} /> Connected to <span className="font-medium">{conn.account}</span>
            </div>
          )}
          <div>
            <h3 className="metric-label mb-2">What agents can do with it</h3>
            <ul className="space-y-1.5">
              {info.does.map((d) => (
                <li key={d} className="flex items-start gap-2 text-sm text-fg-2">
                  <Check size={14} className="mt-0.5 shrink-0 text-fg-4" /> {d}
                </li>
              ))}
            </ul>
          </div>
          {conn && info.apiKey && <EventTypePicker provider={info.id} current={conn.eventType ?? null} />}
          {!conn && info.apiKey && (
            <label className="block">
              <span className="label">{info.apiKey.label}</span>
              <input
                className="field font-mono"
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && apiKey.trim().length >= 8 && !busy && void connect()}
                placeholder={info.apiKey.placeholder}
              />
              <span className="hint block">{info.apiKey.help} It&rsquo;s checked with {info.name} and stored encrypted.</span>
              {error && <span className="mt-2 block text-sm text-rose-700 dark:text-rose-300">{error}</span>}
            </label>
          )}
          {!conn && !info.apiKey && (
            <label className="block">
              <span className="label">{info.id === "webhook" ? "Send each call to" : "Account"}</span>
              <input className={clsx("field", info.id === "webhook" && "font-mono")} value={account} onChange={(e) => setAccount(e.target.value)} placeholder={info.id === "webhook" ? "https://your-server.com/calls" : `Your ${info.name} account`} />
              {info.id !== "webhook" && <span className="hint block">This preview doesn&rsquo;t sign in to {info.name} yet; it only remembers the name.</span>}
            </label>
          )}
          {info.syncsContacts && <p className="text-sm text-fg-3">Once connected, pick which records and fields to bring in under Contacts → Sources.</p>}
        </div>
      )}
    </Sheet>
  );
}

/** Which event type calls book into (a connected calendar). */
function EventTypePicker({ provider, current }: { provider: string; current: { id: number; name: string; minutes: number } | null }) {
  const [types, setTypes] = useState<EventTypeOption[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    eventTypesOf(provider)
      .then((t) => live && setTypes(t))
      .catch((err) => live && setError(err instanceof ApiError ? err.message : "Couldn't load your event types."));
    return () => {
      live = false;
    };
  }, [provider]);
  const pick = (id: number) => {
    setError("");
    setEventType(provider, id).catch((err) => setError(err instanceof ApiError ? err.message : "Couldn't save that."));
  };
  return (
    <label className="block">
      <span className="label">Calls book into</span>
      {types === null && !error ? (
        <div className="field flex items-center gap-2 text-fg-3">
          <Loader2 size={14} className="animate-spin" /> {current ? current.name : "Loading your event types…"}
        </div>
      ) : (
        <select className="field" value={current?.id ?? ""} onChange={(e) => pick(Number(e.target.value))} disabled={!types?.length}>
          {!current && <option value="">Pick an event type</option>}
          {(types ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} ({t.minutes} min)
            </option>
          ))}
        </select>
      )}
      <span className="hint block">{types && !types.length ? "This account has no visible event types. Add one in Cal.com, then reopen this." : "Agents offer free times from this event type and book the one the caller picks."}</span>
      {error && <span className="mt-2 block text-sm text-rose-700 dark:text-rose-300">{error}</span>}
    </label>
  );
}
