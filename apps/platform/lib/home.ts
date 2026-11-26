"use client";

// GET /home: Home's figures, each agent's numbers and trend, recent calls and
// who's due next, in one request. The Agents page reads the same cache.

import { useQuery } from "@tanstack/react-query";
import type { AgentStats } from "@outreach/core/stats";
import type { Call } from "@outreach/core/types";
import { ws } from "./api";
import { useApp } from "./store";

export type HomeWindow = { perDay: { day: string; calls: number; wins: number }[]; calls: number; wins: number; answered: number; talkSec: number; outcomes: { outcome: string; count: number }[] };
export type HomeData = {
  liveNow: number;
  today: number;
  agents: Record<string, { stats: AgentStats; trend: number[]; liveCallId: string | null }>;
  windows: Record<"7" | "14", HomeWindow>;
  recent: { call: Call; contact: { id: string; name: string } | null }[];
  upcoming: { contact: { id: string; name: string }; due: string; campaignId: string; campaignName: string }[];
};

export function useHome() {
  const { workspace } = useApp();
  return useQuery({
    queryKey: ["home", workspace.id],
    queryFn: () => ws<HomeData>("/home"),
    enabled: Boolean(workspace.id),
    refetchInterval: (q) => (q.state.data?.liveNow ? 5000 : 60000),
  });
}
