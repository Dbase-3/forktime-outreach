import { NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { advanceQueue } from "@/lib/queue-runner";
import { getSettings, missingForCalls, setQueueRunning } from "@/lib/settings";
import { workspaceFromRequest } from "@/lib/workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Where the queue stands. Asking also moves it along, so an open screen keeps the calls going. */
export async function GET(request: Request) {
  const workspaceId = await workspaceFromRequest(request);
  if (!workspaceId) return NextResponse.json({ error: "No such workspace" }, { status: 404 });
  return NextResponse.json(await advanceQueue(new Date(), workspaceId));
}

const body = z.object({ action: z.enum(["start", "pause"]) });

export async function POST(request: Request) {
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  const workspaceId = await workspaceFromRequest(request);
  if (!workspaceId) return NextResponse.json({ error: "No such workspace" }, { status: 404 });

  if (parsed.data.action === "start" && env.dialMode() === "live") {
    const missing = missingForCalls(await getSettings(workspaceId));
    if (missing.length) {
      return NextResponse.json({ error: `Set these in Settings first: ${missing.join("; ")}.` }, { status: 400 });
    }
  }
  await setQueueRunning(parsed.data.action === "start", workspaceId);
  return NextResponse.json(await advanceQueue(new Date(), workspaceId));
}
