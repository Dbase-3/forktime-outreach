"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, client } from "@/lib/api";
import { describeWindow } from "@/lib/calling-window";
import { buildOpeningLine } from "@/lib/opening-line";
import { formatPhone } from "@/lib/phone";
import type { Settings } from "@/lib/types";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const COUNTRIES = [
  ["AU", "Australia"],
  ["CA", "Canada"],
  ["US", "United States"],
  ["NZ", "New Zealand"],
  ["GB", "United Kingdom"],
];

function Section({ id, title, intro, children }: { id?: string; title: string; intro?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="card scroll-mt-20 p-5">
      <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
      {intro && <p className="mt-1 text-xs text-gray-500">{intro}</p>}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function Field({
  label,
  hint,
  error,
  wide,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className={wide ? "block sm:col-span-2" : "block"}>
      <span className="label">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-xs text-red-700">{error}</span> : hint ? <span className="hint block">{hint}</span> : null}
    </label>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (next: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 sm:col-span-2">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-gray-300 accent-gray-900" />
      <span>
        <span className="block text-sm text-gray-900">{label}</span>
        {hint && <span className="block text-xs text-gray-500">{hint}</span>}
      </span>
    </label>
  );
}

export function SettingsForm() {
  const queryClient = useQueryClient();
  const saved = useQuery({ queryKey: ["settings"], queryFn: client.settings });
  const numbers = useQuery({ queryKey: ["carrier-numbers"], queryFn: client.carrierNumbers, staleTime: 60_000 });
  const voices = useQuery({ queryKey: ["voices"], queryFn: client.voices, staleTime: 60_000 });

  const [form, setForm] = useState<Settings | null>(null);
  useEffect(() => {
    if (saved.data && !form) setForm(saved.data.settings);
  }, [saved.data, form]);

  const save = useMutation({
    mutationFn: (settings: Settings) => client.saveSettings(settings),
    onSuccess: (view) => {
      queryClient.setQueryData(["settings"], view);
      setForm(view.settings);
    },
  });

  const fieldErrors = useMemo(() => {
    const body = save.error instanceof ApiError ? (save.error.body as { errors?: Array<{ field: string; message: string }> } | null) : null;
    return Object.fromEntries((body?.errors ?? []).map((e) => [e.field, e.message]));
  }, [save.error]);

  const timeZones = useMemo(() => {
    const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
    return supported ? supported("timeZone") : [];
  }, []);

  if (!form) return <div className="card h-96 animate-pulse" />;

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    save.reset();
    setForm({ ...form, [key]: value });
  };
  const dirty = JSON.stringify(form) !== JSON.stringify(saved.data?.settings);
  const voice = voices.data?.voices.find((v) => v.voiceId === form.voiceId);
  const carrier = numbers.data?.numbers ?? [];
  const fromListed = carrier.some((n) => n.phone === form.fromNumber);

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate(form);
      }}
    >
      <Section title="Who is calling" intro="The agent says all of this in its first breath: that it is an AI, who it is calling for, and why.">
        <Field label="Agent's name" error={fieldErrors.agentName}>
          <input className="field" value={form.agentName} onChange={(e) => set("agentName", e.target.value)} />
        </Field>
        <Field label="Calling for" hint="The person an interested owner is connected to." error={fieldErrors.repName}>
          <input className="field" value={form.repName} onChange={(e) => set("repName", e.target.value)} />
        </Field>
        <Field label="Company" error={fieldErrors.company}>
          <input className="field" value={form.company} onChange={(e) => set("company", e.target.value)} />
        </Field>
        <Field label="What the call is about" hint='Reads after "about", so start in lower case. It must be true: the agent says it on every call.' error={fieldErrors.topic}>
          <input className="field" value={form.topic} onChange={(e) => set("topic", e.target.value)} />
        </Field>
        <div className="sm:col-span-2">
          <span className="label">The opening line, as it will be said</span>
          <p className="rounded-md bg-gray-50 p-3 text-sm leading-relaxed text-gray-800">“{buildOpeningLine(form)}”</p>
        </div>
      </Section>

      <Section title="Numbers" intro="Staff are never given details. They are asked to pass on the call-back number.">
        <Field
          label="Calls come from"
          hint={numbers.data?.error ?? "One of the numbers on the carrier account."}
          error={fieldErrors.fromNumber}
        >
          {carrier.length ? (
            <select className="field" value={fromListed ? form.fromNumber : ""} onChange={(e) => set("fromNumber", e.target.value)}>
              <option value="">{form.fromNumber && !fromListed ? `${formatPhone(form.fromNumber)} (not on the account)` : "Pick a number"}</option>
              {carrier.map((n) => (
                <option key={n.phone} value={n.phone}>
                  {formatPhone(n.phone)}
                  {n.connection ? ` · ${n.connection}` : ""}
                </option>
              ))}
            </select>
          ) : (
            <input className="field" placeholder="+61 8 8941 1234" value={form.fromNumber} onChange={(e) => set("fromNumber", e.target.value)} />
          )}
        </Field>
        <Field label="Numbers without a country code are in" error={fieldErrors.defaultCountry}>
          <select className="field" value={form.defaultCountry} onChange={(e) => set("defaultCountry", e.target.value)}>
            {COUNTRIES.map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Connect an interested owner to" hint="This phone rings when an owner says yes." error={fieldErrors.transferNumber}>
          <input className="field" placeholder="+61 412 345 678" value={form.transferNumber} onChange={(e) => set("transferNumber", e.target.value)} />
        </Field>
        <Field label="Call-back number given to staff" error={fieldErrors.callbackNumber}>
          <input className="field" placeholder="+61 412 345 678" value={form.callbackNumber} onChange={(e) => set("callbackNumber", e.target.value)} />
        </Field>
      </Section>

      <Section title="Voice">
        <Field label="The agent's voice" wide error={fieldErrors.voiceId}>
          <select className="field" value={voice ? form.voiceId : ""} onChange={(e) => set("voiceId", e.target.value)}>
            {!voice && <option value="">{form.voiceId} (not in the list)</option>}
            {(voices.data?.voices ?? []).map((v) => (
              <option key={v.voiceId} value={v.voiceId}>
                {v.name} · {v.detail}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Speaking speed"
          hint="Normal uses the most natural voice model, which has one fixed speed. Faster uses the voice model that can be sped up, so it sounds slightly different."
          error={fieldErrors.voiceSpeed}
          wide
        >
          <select className="field" value={String(form.voiceSpeed)} onChange={(e) => set("voiceSpeed", Number(e.target.value))}>
            <option value="1">Normal</option>
            <option value="1.1">Fast (1.1)</option>
            <option value="1.2">Faster (1.2)</option>
          </select>
        </Field>
        {voice?.previewUrl && (
          <div className="sm:col-span-2">
            <span className="label">Sample of this voice</span>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption -- a voice sample has no words to caption */}
            <audio key={voice.voiceId} controls preload="none" src={voice.previewUrl} className="w-full" />
          </div>
        )}
      </Section>

      <Section id="calling-hours" title="Calling hours" intro="A restaurant rung during service hangs up. Calls go out only inside these hours.">
        <Toggle label="Only call inside these hours" checked={form.enforceWindow} onChange={(next) => set("enforceWindow", next)} />
        <Field label="From" error={fieldErrors.windowStart}>
          <input type="time" className="field" value={form.windowStart} onChange={(e) => set("windowStart", e.target.value)} />
        </Field>
        <Field label="Until" error={fieldErrors.windowEnd}>
          <input type="time" className="field" value={form.windowEnd} onChange={(e) => set("windowEnd", e.target.value)} />
        </Field>
        <Field label="On the clock of" hint="The time zone of the restaurants being called." error={fieldErrors.timezone} wide>
          <input className="field" list="time-zones" value={form.timezone} onChange={(e) => set("timezone", e.target.value)} />
          <datalist id="time-zones">
            {timeZones.map((zone) => (
              <option key={zone} value={zone} />
            ))}
          </datalist>
        </Field>
        <fieldset className="sm:col-span-2">
          <legend className="label">On these days</legend>
          <div className="flex flex-wrap gap-2">
            {DAYS.map((day, index) => {
              const value = index + 1;
              const on = form.windowDays.includes(value);
              return (
                <button
                  key={day}
                  type="button"
                  aria-pressed={on}
                  onClick={() => set("windowDays", on ? form.windowDays.filter((d) => d !== value) : [...form.windowDays, value].sort())}
                  className={on ? "btn bg-gray-900 px-3 py-1.5 text-white" : "btn border border-gray-300 bg-white px-3 py-1.5 text-gray-700"}
                >
                  {day}
                </button>
              );
            })}
          </div>
          {fieldErrors.windowDays && <span className="mt-1 block text-xs text-red-700">{fieldErrors.windowDays}</span>}
          <p className="hint">{form.enforceWindow ? describeWindow(form) : "Calls can go out at any time."}</p>
        </fieldset>
        <Field label="Tries per number" hint="A number that does not answer is tried again later." error={fieldErrors.maxAttempts}>
          <input type="number" min={1} max={3} className="field" value={form.maxAttempts} onChange={(e) => set("maxAttempts", Number(e.target.value))} />
        </Field>
        <Field label="Minutes before another try" error={fieldErrors.retryAfterMinutes}>
          <input type="number" min={15} max={1440} className="field" value={form.retryAfterMinutes} onChange={(e) => set("retryAfterMinutes", Number(e.target.value))} />
        </Field>
        <Field label="Seconds to let it ring" error={fieldErrors.ringTimeoutSec}>
          <input type="number" min={15} max={60} className="field" value={form.ringTimeoutSec} onChange={(e) => set("ringTimeoutSec", Number(e.target.value))} />
        </Field>
        <Field label="Longest call, in minutes" error={fieldErrors.maxCallMinutes}>
          <input type="number" min={1} max={15} className="field" value={form.maxCallMinutes} onChange={(e) => set("maxCallMinutes", Number(e.target.value))} />
        </Field>
      </Section>

      <Section title="Recording">
        <Toggle label="Record calls" hint="The recording appears beside the transcript when the call ends." checked={form.recordCalls} onChange={(next) => set("recordCalls", next)} />
        <Toggle
          label='Say "This call is recorded" in the opening line'
          hint="Many places require the other person to know. Leave this on unless your lawyer says otherwise."
          checked={form.recordingNotice}
          onChange={(next) => set("recordingNotice", next)}
        />
      </Section>

      <div className="sticky bottom-4 flex items-center justify-end gap-3 rounded-lg border border-gray-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur">
        {save.isSuccess && !dirty && <span className="text-sm text-emerald-700">Saved.</span>}
        {save.error && <span className="text-sm text-red-700">{Object.keys(fieldErrors).length ? "Fix the fields marked in red." : (save.error as Error).message}</span>}
        <button type="submit" className="btn-primary" disabled={!dirty || save.isPending}>
          {save.isPending ? "Saving…" : "Save settings"}
        </button>
      </div>
    </form>
  );
}
