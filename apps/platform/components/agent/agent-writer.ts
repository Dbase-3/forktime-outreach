"use client";

// Calls /api/agents/generate: write a whole agent from a description, or
// rebuild just its workflow from its instructions.

import { useRef, useState } from "react";
import type { DraftParts, DraftRequest } from "@outreach/core/agent-draft";
import type { AppState, Step } from "@outreach/core/types";

export function draftFields(app: AppState): DraftRequest["fields"] {
  return app.fieldDefs.map((d) => ({ key: d.key, label: d.label, type: d.type }));
}

export function useAgentWriter() {
  const [busy, setBusy] = useState<null | "agent" | "workflow">(null);
  const [mode, setMode] = useState<"agent" | "workflow" | null>(null); // what the last call was
  const [error, setError] = useState<string | null>(null);
  const last = useRef<string | null>(null); // the latest error, readable straight after an await

  async function call<T>(req: DraftRequest): Promise<T | null> {
    setBusy(req.mode);
    setMode(req.mode);
    setError(null);
    last.current = null;
    try {
      const res = await fetch("/api/agents/generate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(req) });
      const body = (await res.json().catch(() => ({}))) as T & { error?: string };
      if (!res.ok) {
        last.current = body.error ?? "Something went wrong. Try again.";
        setError(last.current);
        return null;
      }
      return body;
    } catch {
      last.current = "Couldn't reach the server. Check your connection and try again.";
      setError(last.current);
      return null;
    } finally {
      setBusy(null);
    }
  }

  return {
    busy,
    mode,
    error,
    lastError: () => last.current,
    clearError: () => setError(null),
    writeAgent: async (req: Omit<DraftRequest, "mode">) => (await call<{ draft: DraftParts }>({ ...req, mode: "agent" }))?.draft ?? null,
    rebuildWorkflow: async (req: Omit<DraftRequest, "mode">) => (await call<{ steps: Step[] }>({ ...req, mode: "workflow" }))?.steps ?? null,
  };
}
