import { NextResponse } from "next/server";
import { agentEventSchema, applyAgentEvent } from "@/lib/agent-events";
import { agentKeyMatches } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The voice agent's reports on a running call. Its key, not a login, opens this door. */
export async function POST(request: Request) {
  if (!agentKeyMatches(request.headers.get("x-agent-key"))) {
    return NextResponse.json({ error: "Wrong agent key" }, { status: 401 });
  }
  const parsed = agentEventSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Malformed event", issues: parsed.error.issues }, { status: 400 });

  const result = await applyAgentEvent(parsed.data);
  if (!result.ok) return NextResponse.json({ error: result.message }, { status: result.status });
  return NextResponse.json({ ok: true });
}
