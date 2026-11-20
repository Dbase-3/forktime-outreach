import { NextResponse } from "next/server";
import { getCall, getTranscript, toCallJson, toLineJson } from "@/lib/calls-repo";
import { workspaceFromRequest } from "@/lib/workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const workspaceId = await workspaceFromRequest(request);
  if (!workspaceId) return NextResponse.json({ error: "No such workspace" }, { status: 404 });
  const call = await getCall(params.id, workspaceId);
  if (!call) return NextResponse.json({ error: "No such call" }, { status: 404 });
  const transcript = await getTranscript(call._id);
  return NextResponse.json({ call: toCallJson(call), transcript: transcript.map(toLineJson) });
}
