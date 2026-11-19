import { NextResponse } from "next/server";
import { listVoices } from "@/lib/carrier";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ voices: await listVoices() });
}
