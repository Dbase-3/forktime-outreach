import { NextResponse } from "next/server";
import { describeWindow } from "@/lib/calling-window";
import { buildOpeningLine } from "@/lib/opening-line";
import { getSettings, missingForCalls, saveSettings, validateSettings } from "@/lib/settings";
import type { Settings } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const view = (settings: Settings) => ({
  settings,
  openingLine: buildOpeningLine(settings),
  window: describeWindow(settings),
  missing: missingForCalls(settings),
});

export async function GET() {
  return NextResponse.json(view(await getSettings()));
}

export async function PUT(request: Request) {
  const result = validateSettings(await request.json().catch(() => null));
  if ("errors" in result) return NextResponse.json({ errors: result.errors }, { status: 400 });
  return NextResponse.json(view(await saveSettings(result.settings)));
}
