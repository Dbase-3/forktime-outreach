import { NextResponse } from "next/server";
import { getCall, getTranscript, toCallJson, toLineJson } from "@/lib/calls-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const call = await getCall(params.id);
  if (!call) return NextResponse.json({ error: "No such call" }, { status: 404 });
  const transcript = await getTranscript(call._id);
  return NextResponse.json({ call: toCallJson(call), transcript: transcript.map(toLineJson) });
}
