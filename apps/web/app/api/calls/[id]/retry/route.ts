import { NextResponse } from "next/server";
import { z } from "zod";
import { addCalls, getCall } from "@/lib/calls-repo";
import { dncPhones } from "@/lib/dnc";
import { getSettings } from "@/lib/settings";

export const runtime = "nodejs";

const body = z.object({ at: z.string().datetime({ offset: true }).optional() });

/**
 * Queue a finished number again, as a new call, so the earlier one keeps its
 * record. With `at`, it is not dialled before that moment (the owner's time).
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const parsed = body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "That is not a time we can read." }, { status: 400 });
  const at = parsed.data.at ? new Date(parsed.data.at) : null;
  if (at && at.getTime() < Date.now() - 60_000) return NextResponse.json({ error: "That time has already passed." }, { status: 400 });
  const call = await getCall(params.id);
  if (!call) return NextResponse.json({ error: "No such call" }, { status: 404 });
  if (call.status !== "ended" && call.status !== "cancelled") {
    return NextResponse.json({ error: "This call has not finished yet." }, { status: 409 });
  }
  if ((await dncPhones()).has(call.phone)) {
    return NextResponse.json({ error: "This number is on the do-not-call list." }, { status: 409 });
  }
  const settings = await getSettings();
  const [added] = await addCalls([{ phone: call.phone, label: call.label }], settings.fromNumber, new Date(), at);
  return NextResponse.json({ ok: true, callId: added._id });
}
