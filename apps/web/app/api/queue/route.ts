import { NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { advanceQueue } from "@/lib/queue-runner";
import { getSettings, missingForCalls, setQueueRunning } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Where the queue stands. Asking also moves it along, so an open screen keeps the calls going. */
export async function GET() {
  return NextResponse.json(await advanceQueue());
}

const body = z.object({ action: z.enum(["start", "pause"]) });

export async function POST(request: Request) {
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Unknown action" }, { status: 400 });

  if (parsed.data.action === "start" && env.dialMode() === "live") {
    const missing = missingForCalls(await getSettings());
    if (missing.length) {
      return NextResponse.json({ error: `Set these in Settings first: ${missing.join("; ")}.` }, { status: 400 });
    }
  }
  await setQueueRunning(parsed.data.action === "start");
  return NextResponse.json(await advanceQueue());
}
