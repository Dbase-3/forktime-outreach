import { NextResponse } from "next/server";
import { extractImportWithGrok } from "@/lib/imports";
import { env } from "@/lib/env";
import { getSettings } from "@/lib/settings";
import { workspaceFromRequest } from "@/lib/workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_FILE_BYTES = 4 * 1024 * 1024;

/** Parse a restaurant list with Grok. It only produces a review preview; it never queues a call. */
export async function POST(request: Request) {
  const workspaceId = await workspaceFromRequest(request);
  if (!workspaceId) return NextResponse.json({ error: "No such workspace" }, { status: 404 });
  const form = await request.formData().catch(() => null);
  const candidate = form?.get("file");
  if (!(candidate instanceof File) || !candidate.size) return NextResponse.json({ error: "Choose a file to import." }, { status: 400 });
  if (candidate.size > MAX_FILE_BYTES) return NextResponse.json({ error: "Use a file smaller than 4 MB." }, { status: 413 });

  try {
    const settings = await getSettings(workspaceId);
    const entries = await extractImportWithGrok(candidate, env.xaiApiKey(), settings.defaultCountry);
    return NextResponse.json({ fileName: candidate.name, entries });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message || "Could not read that file." }, { status: 422 });
  }
}
