import { NextResponse } from "next/server";
import { closeQueued, getCall } from "@/lib/calls-repo";
import { closeRoom } from "@/lib/dialer";
import { advanceQueue, finishCall } from "@/lib/queue-runner";
import { getSettings } from "@/lib/settings";
import { workspaceFromRequest } from "@/lib/workspaces";

export const runtime = "nodejs";

/** Take a number out of the queue, or hang up the call that is on the line. */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const workspaceId = await workspaceFromRequest(request);
  if (!workspaceId) return NextResponse.json({ error: "No such workspace" }, { status: 404 });
  const call = await getCall(params.id, workspaceId);
  if (!call) return NextResponse.json({ error: "No such call" }, { status: 404 });

  if (call.status === "queued") {
    await closeQueued(call._id, "cancelled", "cancelled");
  } else if (call.status === "dialing" || call.status === "live") {
    if (!call.simulated && call.roomName) await closeRoom(call.roomName);
    await finishCall(call._id, { outcome: "cancelled" }, await getSettings(workspaceId), new Date(), workspaceId);
    await advanceQueue(new Date(), workspaceId);
  } else {
    return NextResponse.json({ error: "This call has already finished." }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}
