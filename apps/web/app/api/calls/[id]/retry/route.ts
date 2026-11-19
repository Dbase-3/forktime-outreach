import { NextResponse } from "next/server";
import { addCalls, getCall } from "@/lib/calls-repo";
import { dncPhones } from "@/lib/dnc";
import { getSettings } from "@/lib/settings";

export const runtime = "nodejs";

/** Queue a finished number again, as a new call, so the earlier one keeps its record. */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const call = await getCall(params.id);
  if (!call) return NextResponse.json({ error: "No such call" }, { status: 404 });
  if (call.status !== "ended" && call.status !== "cancelled") {
    return NextResponse.json({ error: "This call has not finished yet." }, { status: 409 });
  }
  if ((await dncPhones()).has(call.phone)) {
    return NextResponse.json({ error: "This number is on the do-not-call list." }, { status: 409 });
  }
  const settings = await getSettings();
  const [added] = await addCalls([{ phone: call.phone, label: call.label }], settings.fromNumber);
  return NextResponse.json({ ok: true, callId: added._id });
}
