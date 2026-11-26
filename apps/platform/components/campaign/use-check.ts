"use client";

// The audience count, who's skipped, the start checks and who's due next, for
// the campaign as it is on screen, worked out on the server (the contacts live
// there). Waits a moment after edits so typing doesn't send a request per key.

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { CampaignInputSchema } from "@outreach/core/schemas";
import type { Campaign } from "@outreach/core/types";
import { useEffect, useState } from "react";
import { ws } from "@/lib/api";

export interface CampaignCheck {
  audienceCount: number;
  skipped: { doNotCall: number; badPhone: number };
  issues: string[];
  upcoming: { total: number; next: { contact: { id: string; name: string }; due: string }[] };
}

const CONFIG_KEYS = Object.keys(CampaignInputSchema.shape) as (keyof Campaign)[];

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function useCampaignCheck(c: Campaign | undefined, workspaceId: string) {
  const config = c ? Object.fromEntries(CONFIG_KEYS.map((k) => [k, c[k]])) : null;
  const key = useDebounced(config ? JSON.stringify(config) : "", 350);
  return useQuery({
    queryKey: ["campaign-check", workspaceId, c?.id, c?.status, key],
    queryFn: () => ws<CampaignCheck>("/campaigns/check", { body: { config: JSON.parse(key), status: c?.status ?? "draft" } }),
    enabled: Boolean(key),
    placeholderData: keepPreviousData,
  });
}
