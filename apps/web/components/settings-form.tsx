"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, client } from "@/lib/api";
import { describeWindow } from "@/lib/calling-window";
import { DEFAULT_WELCOME, PLACEHOLDERS, WELCOME_LABELS, renderWelcome, type WelcomeKey } from "@/lib/opening-line";
import { formatPhone } from "@/lib/phone";
import type { Settings } from "@/lib/types";
import { useWorkspace } from "./workspace-provider";

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

/** One welcome message: the template to edit, buttons that drop in a placeholder, and how it will sound. */
function WelcomeField({
  title,
  when,
  value,
  preview,
  error,
  isDefault,
  onChange,
  onReset,
}: {
  title: string;
  when: string;
  value: string;
  preview: string;
  error?: string;
  isDefault: boolean;
  onChange: (next: string) => void;
  onReset: () => void;
}) {
  const box = useRef<HTMLTextAreaElement>(null);
  const insert = (name: string) => {
    const el = box.current;
    const at = el ? el.selectionStart : value.length;
    const end = el ? el.selectionEnd : value.length;
    onChange(`${value.slice(0, at)}{${name}}${value.slice(end)}`);
  };
  return (
    <div className="sm:col-span-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="label mb-0">{title}</span>
        {!isDefault && (
          <button type="button" className="text-xs text-gray-600 underline hover:text-gray-900" onClick={onReset}>
            Reset to the original
          </button>
        )}
      </div>
      <p className="hint mb-1.5 mt-0">{when}</p>
      <textarea ref={box} rows={3} className="field leading-relaxed" value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={!!error} />
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {PLACEHOLDERS.map((p) => (
          <button key={p.name} type="button" title={p.meaning} className="rounded border border-gray-300 bg-white px-1.5 py-0.5 text-xs text-gray-700 hover:bg-gray-50" onClick={() => insert(p.name)}>
            {`{${p.name}}`}
          </button>
        ))}
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-xs text-red-700">
          {error}
        </p>
      ) : (
        <p className="mt-2 rounded-md bg-gray-50 p-3 text-sm leading-relaxed text-gray-800">
          <span className="mb-0.5 block text-[11px] font-medium uppercase tracking-wide text-gray-400">As it will be said</span>“{preview}”
        </p>
      )}
    </div>
  );
}

export function SettingsForm() {
  const queryClient = useQueryClient();
  const { workspaceId } = useWorkspace();
  const saved = useQuery({ queryKey: ["settings", workspaceId], queryFn: () => client.settings(workspaceId as string), enabled: !!workspaceId });
  const numbers = useQuery({ queryKey: ["carrier-numbers"], queryFn: client.carrierNumbers, staleTime: 60_000 });
  const voices = useQuery({ queryKey: ["voices"], queryFn: client.voices, staleTime: 60_000 });

  const [form, setForm] = useState<Settings | null>(null);
  useEffect(() => {
    if (saved.data && !form) setForm(saved.data.settings);
  }, [saved.data, form]);
  useEffect(() => setForm(null), [workspaceId]);

  const save = useMutation({
    mutationFn: (settings: Settings) => client.saveSettings(workspaceId as string, settings),
    onSuccess: (view) => {
      queryClient.setQueryData(["settings", workspaceId], view);
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
  const voice = voices.data?.voices.find((v) => v.voiceId === form.voiceId && v.provider === form.voiceProvider);
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
      <Section title="Who is calling" intro="This identity belongs to this workspace. The agent opens with the booking enquiry and explains the AI service only after speaking with the owner or manager.">
        <Field label="Agent's name" error={fieldErrors.agentName}>
          <input className="field" value={form.agentName} onChange={(e) => set("agentName", e.target.value)} />
        </Field>
        <Field label="Follow-up contact" hint="The person available if an owner specifically asks to speak with someone now." error={fieldErrors.repName}>
          <input className="field" value={form.repName} onChange={(e) => set("repName", e.target.value)} />
        </Field>
        <Field label="Company" error={fieldErrors.company}>
          <input className="field" value={form.company} onChange={(e) => set("company", e.target.value)} />
        </Field>
        <Field label="What the call is about" hint='Reads after "about", so start in lower case. It must be true: the agent says it on every call.' error={fieldErrors.topic}>
          <input className="field" value={form.topic} onChange={(e) => set("topic", e.target.value)} />
        </Field>
      </Section>

      <Section
        id="welcome-messages"
        title="What the agent says first"
        intro="Three messages, for the three ways a call starts. Change the wording freely; the agent says them word for word. Keep the opening focused on the booking enquiry."
      >
        {(Object.keys(WELCOME_LABELS) as WelcomeKey[]).map((key) => (
          <WelcomeField
            key={key}
            title={WELCOME_LABELS[key].title}
            when={WELCOME_LABELS[key].when}
            value={form[key]}
            preview={renderWelcome(form[key], form)}
            error={fieldErrors[key]}
            isDefault={form[key] === DEFAULT_WELCOME[key]}
            onChange={(next) => set(key, next)}
            onReset={() => set(key, DEFAULT_WELCOME[key])}
          />
        ))}
        <p className="hint sm:col-span-2">
          Placeholders:{" "}
          {PLACEHOLDERS.map((p, i) => (
            <span key={p.name}>
              {i > 0 && " · "}
              <code className="rounded bg-gray-100 px-1">{`{${p.name}}`}</code> {p.meaning}
            </span>
          ))}
        </p>
      </Section>

      <Section title="Numbers" intro="Staff are never given details. If the owner is out, they are asked when they will be free and to call back on the call-back number.">
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
        <Field label="Live-conversation number" hint="This phone rings only when an owner specifically asks to speak to someone now." error={fieldErrors.transferNumber}>
          <input className="field" placeholder="+61 412 345 678" value={form.transferNumber} onChange={(e) => set("transferNumber", e.target.value)} />
        </Field>
        <Field label="Call-back number" hint="The number restaurants call back. It must reach this agent (see the README), or they get another agent." error={fieldErrors.callbackNumber}>
          <input className="field" placeholder="+1 418 431 3732" value={form.callbackNumber} onChange={(e) => set("callbackNumber", e.target.value)} />
        </Field>
      </Section>

      <Section title="Voice">
        <Field label="The agent's voice" wide error={fieldErrors.voiceId}>
          <select
            className="field"
            value={voice ? `${voice.provider}:${voice.voiceId}` : ""}
            onChange={(e) => {
              const [provider, ...id] = e.target.value.split(":");
              setForm({ ...form, voiceProvider: provider as Settings["voiceProvider"], voiceId: id.join(":") });
              save.reset();
            }}
          >
            {!voice && <option value="">{form.voiceId} (not in the list)</option>}
            {(voices.data?.voices ?? []).map((v) => (
              <option key={`${v.provider}:${v.voiceId}`} value={`${v.provider}:${v.voiceId}`}>
                {v.name} · {v.detail}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label="Speaking speed"
          hint="Fish Audio voices speed up with no change in sound. For ElevenLabs voices, normal uses the most natural model, which has one fixed speed, and faster switches to a model that can be sped up."
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
