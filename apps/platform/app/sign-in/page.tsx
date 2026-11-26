"use client";

// Sign in with an emailed 6-digit code (no passwords). New emails get an
// account on first sign-in; invites are joined then too.

import { ArrowLeft, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ApiError, request } from "@/lib/api";
import { AuthCard } from "@/components/auth-card";
import { CodeInput } from "@/components/auth/code-input";

const RESEND_AFTER = 30; // seconds before "Send a new code" works again

export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await request("/auth/code", { body: { email } });
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

  if (step === "email") {
    return (
      <AuthCard title="Sign in">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <label className="block">
            <span className="label">Work email</span>
            <input className="field h-10" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@business.com" autoFocus required />
          </label>
          <button type="submit" className="btn-primary mt-4 h-10 w-full" disabled={busy || !email.includes("@")}>
            {busy && <Loader2 size={15} className="animate-spin" />} Continue with email
          </button>
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
