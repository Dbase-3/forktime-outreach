import { NextResponse } from "next/server";
import { describeWindow } from "@/lib/calling-window";
import { buildOpeningLine } from "@/lib/opening-line";
import { getSettings, missingForCalls, saveSettings, validateSettings } from "@/lib/settings";
import type { Settings } from "@/lib/types";
import { workspaceFromRequest } from "@/lib/workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const view = (settings: Settings) => ({
  settings,
  openingLine: buildOpeningLine(settings),
  window: describeWindow(settings),
  missing: missingForCalls(settings),
});

export async function GET(request: Request) {
  const workspaceId = await workspaceFromRequest(request);
  if (!workspaceId) return NextResponse.json({ error: "No such workspace" }, { status: 404 });
  return NextResponse.json(view(await getSettings(workspaceId)));
}

export async function PUT(request: Request) {
  const workspaceId = await workspaceFromRequest(request);
  if (!workspaceId) return NextResponse.json({ error: "No such workspace" }, { status: 404 });
  const result = validateSettings(await request.json().catch(() => null));
  if ("errors" in result) return NextResponse.json({ errors: result.errors }, { status: 400 });
  return NextResponse.json(view(await saveSettings(result.settings, workspaceId)));
}
