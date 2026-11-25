// Numbers for Home: calls per day and each agent's day so far. Pure.

import type { Call, Flow } from "./types";

const DAY = 24 * 60 * 60 * 1000;

/** Outcomes that mean the call did its job (booked, set, transferred, …). */
export function isWin(outcome: string): boolean {
  return /booked|_set|promise|transferred|given|taken/.test(outcome);
}

export function answered(call: Call): boolean {
  return call.outcome !== "no_answer" && call.outcome !== "failed";
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export interface DayPoint {
  day: Date;
  calls: number;
  wins: number;
}

/** One point per day, oldest first, ending today. Live calls are not counted yet. */
export function callsPerDay(calls: Call[], days: number, now: Date): DayPoint[] {
  const today = startOfDay(now).getTime();
  const points: DayPoint[] = Array.from({ length: days }, (_, i) => ({ day: new Date(today - (days - 1 - i) * DAY), calls: 0, wins: 0 }));
  for (const call of calls) {
    if (call.live) continue;
    const index = days - 1 - Math.round((today - startOfDay(new Date(call.startedAt)).getTime()) / DAY);
    if (index < 0 || index >= days) continue;
    points[index].calls++;
    if (isWin(call.outcome)) points[index].wins++;
  }
  return points;
}

export interface AgentStats {
  liveNow: number;
  today: number;
  week: number;
  answerRate: number | null; // 0..1, null with no calls this week
  avgSec: number | null;
  lastCallAt: string | null;
}

export function agentStats(flow: Pick<Flow, "id">, calls: Call[], now: Date): AgentStats {
  const mine = calls.filter((c) => c.flowId === flow.id);
  const today = startOfDay(now).getTime();
  const weekAgo = now.getTime() - 7 * DAY;
  const done = mine.filter((c) => !c.live);
  const week = done.filter((c) => new Date(c.startedAt).getTime() >= weekAgo);
  const talked = week.filter(answered);
  const last = done.reduce<string | null>((latest, c) => (!latest || c.startedAt > latest ? c.startedAt : latest), null);
  return {
    liveNow: mine.filter((c) => c.live).length,
    today: done.filter((c) => new Date(c.startedAt).getTime() >= today).length,
    week: week.length,
    answerRate: week.length ? talked.length / week.length : null,
    avgSec: talked.length ? Math.round(talked.reduce((sum, c) => sum + c.durationSec, 0) / talked.length) : null,
    lastCallAt: last,
  };
}

export function totals(points: DayPoint[]): { calls: number; wins: number } {
  return points.reduce((t, p) => ({ calls: t.calls + p.calls, wins: t.wins + p.wins }), { calls: 0, wins: 0 });
}
