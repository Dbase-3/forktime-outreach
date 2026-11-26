"use client";

// Sign in with an emailed 6-digit code (no passwords). New emails get an
// account on first sign-in; invites are joined then too.

import { ArrowLeft, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError, request } from "@/lib/api";
import { AuthCard } from "@/components/auth-card";

export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await request("/auth/code", { body: { email } });
      setStep("code");
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

  return (
    <AuthCard title={step === "email" ? "Sign in" : "Check your email"} subtitle={step === "email" ? "We'll email you a 6-digit code. No password needed." : `We sent a code to ${email}. It works for 10 minutes.`}>
      {step === "email" ? (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <label className="block">
            <span className="label">Work email</span>
            <input className="field" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@business.com" autoFocus required />
          </label>
          <button type="submit" className="btn-primary w-full" disabled={busy || !email.includes("@")}>
            {busy && <Loader2 size={15} className="animate-spin" />} Email me a code
          </button>
        </form>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void verify();
          }}
        >
          <label className="block">
            <span className="label">Code</span>
            <input
              className="field text-center font-mono text-lg tracking-[0.4em]"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, "").slice(0, 6);
                setCode(v);
                if (v.length === 6) void verify(v);
              }}
              autoFocus
            />
          </label>
          <button type="submit" className="btn-primary w-full" disabled={busy || code.length !== 6}>
            {busy && <Loader2 size={15} className="animate-spin" />} Sign in
          </button>
          <div className="flex justify-between text-sm">
            <button type="button" className="flex items-center gap-1 text-fg-3 hover:text-fg" onClick={() => { setStep("email"); setCode(""); }}><ArrowLeft size={14} /> Different email</button>
            <button type="button" className="text-fg-3 hover:text-fg" onClick={() => void send()} disabled={busy}>Send a new code</button>
          </div>
        </form>
      )}
      {error && <p className="mt-3 text-sm text-rose-700 dark:text-rose-400" role="alert">{error}</p>}
    </AuthCard>
  );
}
