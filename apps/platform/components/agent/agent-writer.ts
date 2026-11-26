"use client";

// Calls /api/agents/generate: write a whole agent from a description, or
// rebuild just its workflow from its instructions.

import { useState } from "react";
import type { DraftParts, DraftRequest } from "@outreach/core/agent-draft";
import type { AppState, Step } from "@outreach/core/types";

export function draftFields(app: AppState): DraftRequest["fields"] {
  return app.fieldDefs.map((d) => ({ key: d.key, label: d.label, type: d.type }));
}

export function useAgentWriter() {
  const [busy, setBusy] = useState<null | "agent" | "workflow">(null);
  const [error, setError] = useState<string | null>(null);

  async function call<T>(req: DraftRequest): Promise<T | null> {
    setBusy(req.mode);
    setError(null);
    try {
      const res = await fetch("/api/agents/generate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(req) });
      const body = (await res.json().catch(() => ({}))) as T & { error?: string };
      if (!res.ok) {
        setError(body.error ?? "Something went wrong. Try again.");
        return null;
      }
      return body;
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
      return null;
    } finally {
      setBusy(null);
    }
  }

  return {
    busy,
    error,
    clearError: () => setError(null),
    writeAgent: async (req: Omit<DraftRequest, "mode">) => (await call<{ draft: DraftParts }>({ ...req, mode: "agent" }))?.draft ?? null,
    rebuildWorkflow: async (req: Omit<DraftRequest, "mode">) => (await call<{ steps: Step[] }>({ ...req, mode: "workflow" }))?.steps ?? null,
  };
}
