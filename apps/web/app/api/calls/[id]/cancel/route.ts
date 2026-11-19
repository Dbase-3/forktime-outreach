import { NextResponse } from "next/server";
import { closeQueued, getCall } from "@/lib/calls-repo";
import { closeRoom } from "@/lib/dialer";
import { advanceQueue, finishCall } from "@/lib/queue-runner";
import { getSettings } from "@/lib/settings";

export const runtime = "nodejs";

/** Take a number out of the queue, or hang up the call that is on the line. */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const call = await getCall(params.id);
  if (!call) return NextResponse.json({ error: "No such call" }, { status: 404 });

  if (call.status === "queued") {
    await closeQueued(call._id, "cancelled", "cancelled");
  } else if (call.status === "dialing" || call.status === "live") {
    if (!call.simulated && call.roomName) await closeRoom(call.roomName);
    await finishCall(call._id, { outcome: "cancelled" }, await getSettings());
    await advanceQueue();
  } else {
    return NextResponse.json({ error: "This call has already finished." }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}
