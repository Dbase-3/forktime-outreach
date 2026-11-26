"use client";

// Sign in with an emailed 6-digit code (no passwords). New emails get an
// account on first sign-in; invites are joined then too.

import { ArrowLeft, Github, KeyRound, Loader2, Mail } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ApiError, request } from "@/lib/api";
import { AuthCard } from "@/components/auth-card";
import { CodeInput } from "@/components/auth/code-input";

const RESEND_AFTER = 30; // seconds before "Send a new code" works again

/** Placeholders for now (owner 2026-11-27): they say "coming soon". Email is the way in. */
const PROVIDERS = [
  { id: "google", name: "Google", icon: <GoogleMark /> },
  { id: "github", name: "GitHub", icon: <Github size={17} /> },
  { id: "sso", name: "SSO", icon: <KeyRound size={17} /> },
];

/** How this browser last signed in, so a returning person gets one button (LiveKit-style). Kept in localStorage only. */
const LAST_KEY = "ft.lastSignIn";
type Last = { method: "email"; email: string };
function readLast(): Last | null {
  try {
    const v = JSON.parse(localStorage.getItem(LAST_KEY) ?? "null") as Last | null;
    return v && v.method === "email" && typeof v.email === "string" && v.email.includes("@") ? v : null;
  } catch {
    // Storage blocked or unreadable: show the full sign-in.
    return null;
  }
}
function saveLast(last: Last) {
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify(last));
  } catch {
    // Storage blocked: next time shows the full sign-in, which is fine.
  }
}

function GoogleMark() {
  return (
    <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState(0);
  const [soon, setSoon] = useState<string | null>(null); // a sign-in option that isn't built yet
  const [last, setLast] = useState<Last | null>(null);
  const [returning, setReturning] = useState(false); // "Welcome back": one button for how they signed in last
  useEffect(() => {
    const l = readLast();
    setLast(l);
    setReturning(Boolean(l));
  }, []);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const send = async (to = email) => {
    setBusy(true);
    setError(null);
    try {
      await request("/auth/code", { body: { email: to } });
      setStep("code");
      setCode("");
      setWait(RESEND_AFTER);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't send the code.");
    } finally {
      setBusy(false);
    }
  };
  const verify = async (value = code) => {
    if (value.length !== 6) return;
    setBusy(true);
    setError(null);
    try {
      await request("/auth/verify", { body: { email, code: value } });
      saveLast({ method: "email", email });
      const next = new URLSearchParams(window.location.search).get("next");
      router.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : "/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't sign in.");
      setBusy(false);
    }
  };

  const errorLine = error && (
    <p className="mt-3 text-sm text-rose-700 dark:text-rose-400" role="alert">
      {error}
    </p>
  );

  if (step === "email" && returning && last) {
    return (
      <AuthCard title="Welcome back">
        <button
          type="button"
          className="btn-secondary relative h-11 w-full text-sm"
          disabled={busy}
          onClick={() => {
            setEmail(last.email);
            void send(last.email);
          }}
        >
          <span className="absolute left-4 flex items-center">{busy ? <Loader2 size={16} className="animate-spin" /> : <Mail size={16} />}</span>
          <span className="truncate px-8">Continue as {last.email}</span>
        </button>
        {errorLine}
        <button type="button" className="mt-6 w-full text-center text-sm text-fg-3 hover:text-fg" onClick={() => setReturning(false)}>
          Sign in with a different method
        </button>
      </AuthCard>
    );
  }

  if (step === "email") {
    return (
      <AuthCard
        title="Sign in"
        footer={
          <>
            By continuing you agree to our{" "}
            <a href="https://forktime.ai/terms" target="_blank" rel="noreferrer" className="text-fg-2 underline underline-offset-2 hover:text-fg">terms of service</a> and{" "}
            <a href="https://forktime.ai/privacy" target="_blank" rel="noreferrer" className="text-fg-2 underline underline-offset-2 hover:text-fg">privacy policy</a>.
          </>
        }
      >
        <div className="space-y-2.5">
          {PROVIDERS.map((p) => (
            <button key={p.id} type="button" className="btn-secondary relative h-11 w-full text-sm" onClick={() => setSoon(p.name)}>
              <span className="absolute left-4 flex items-center">{p.icon}</span>
              Continue with {p.name}
            </button>
          ))}
          {soon && (
            <p className="pt-1 text-center text-sm text-fg-3" role="status">
              {soon} sign-in is coming soon. Use your email for now.
            </p>
          )}
        </div>

        <div className="my-6 flex items-center gap-3" aria-hidden>
          <span className="h-px flex-1 bg-gradient-to-r from-transparent to-line-strong" />
          <span className="text-xs font-medium text-fg-3">OR</span>
          <span className="h-px flex-1 bg-gradient-to-l from-transparent to-line-strong" />
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <label className="block">
            <span className="sr-only">Work email</span>
            <input className="field h-11" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" required />
          </label>
          <div className="relative mt-2.5">
            <button type="submit" className="btn-primary h-11 w-full" disabled={busy || !email.includes("@")}>
              {busy && <Loader2 size={15} className="animate-spin" />} Continue with email
            </button>
            {last && <span className="absolute -top-2.5 right-3 rounded-full border border-accent/30 bg-surface px-2 py-0.5 text-2xs font-medium text-accent">Last used</span>}
          </div>
          {errorLine}
        </form>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Check your email"
      subtitle={
        <>
          We sent a 6-digit code to <span className="font-medium text-fg">{email}</span>. It works for 10 minutes.
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void verify();
        }}
      >
        <CodeInput
          value={code}
          disabled={busy}
          invalid={!!error}
          onChange={(v) => {
            setCode(v);
            setError(null);
            if (v.length === 6) void verify(v);
          }}
        />
        <button type="submit" className="btn-primary mt-4 h-10 w-full" disabled={busy || code.length !== 6}>
          {busy && <Loader2 size={15} className="animate-spin" />} Sign in
        </button>
        {errorLine}
        <p className="mt-4 text-sm text-fg-3">Can&apos;t find it? Check your spam or promotions folder.</p>
        <div className="mt-6 flex items-center justify-between border-t border-line pt-4 text-sm">
          <button
            type="button"
            className="flex items-center gap-1 text-fg-3 hover:text-fg"
            onClick={() => {
              setStep("email");
              setReturning(false);
              setCode("");
              setError(null);
            }}
          >
            <ArrowLeft size={14} /> Different email
          </button>
          <button type="button" className="text-fg-2 hover:text-fg disabled:text-fg-4" onClick={() => void send()} disabled={busy || wait > 0}>
            {wait > 0 ? `Send a new code in ${wait}s` : "Send a new code"}
          </button>
        </div>
      </form>
    </AuthCard>
  );
}
