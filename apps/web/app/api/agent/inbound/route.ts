import { NextResponse } from "next/server";
import { z } from "zod";
import { agentKeyMatches } from "@/lib/auth";
import { startInboundCall } from "@/lib/inbound";
import { toE164 } from "@/lib/phone";
import { getSettings } from "@/lib/settings";
import { workspaceForCalledNumber } from "@/lib/workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({ phone: z.string().min(3).max(40), calledNumber: z.string().max(40).default(""), roomName: z.string().min(1).max(200) });

/** The voice agent, when someone rings the call-back number: who is this, and what do we know? */
export async function POST(request: Request) {
  if (!agentKeyMatches(request.headers.get("x-agent-key"))) {
    return NextResponse.json({ error: "Wrong agent key" }, { status: 401 });
  }
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Malformed request" }, { status: 400 });

  // The number they called decides which customer/workspace owns the callback.
  const workspaceId = await workspaceForCalledNumber(parsed.data.calledNumber);
  const country = (await getSettings(workspaceId)).defaultCountry;
  // A caller with a hidden number can't be matched to anything: the call is still taken, as a new one.
  const phone = toE164(parsed.data.phone, country) ?? parsed.data.phone;
  const calledNumber = toE164(parsed.data.calledNumber, country) ?? parsed.data.calledNumber;
  return NextResponse.json(await startInboundCall({ phone, calledNumber, roomName: parsed.data.roomName, workspaceId }));
}
