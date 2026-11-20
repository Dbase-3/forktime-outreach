import { NextResponse } from "next/server";
import { z } from "zod";
import { addCalls, listCalls, toCallJson } from "@/lib/calls-repo";
import { dncPhones } from "@/lib/dnc";
import { parseNumberList } from "@/lib/phone";
import { getSettings } from "@/lib/settings";
import { workspaceFromRequest } from "@/lib/workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const workspaceId = await workspaceFromRequest(request);
  if (!workspaceId) return NextResponse.json({ error: "No such workspace" }, { status: 404 });
  return NextResponse.json({ calls: (await listCalls(200, workspaceId)).map(toCallJson) });
}

const body = z.union([
  z.object({ numbers: z.string().min(1).max(100_000) }),
  z.object({ entries: z.array(z.object({ phone: z.string().trim().min(3).max(40), label: z.string().trim().max(160) })).min(1).max(500) }),
]);

/** Add a pasted list of numbers to the end of the queue. Nothing is dialled until Start. */
export async function POST(request: Request) {
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Add at least one restaurant number." }, { status: 400 });
  const workspaceId = await workspaceFromRequest(request);
  if (!workspaceId) return NextResponse.json({ error: "No such workspace" }, { status: 404 });

  const settings = await getSettings(workspaceId);
  const list = "numbers" in parsed.data
    ? parseNumberList(parsed.data.numbers, settings.defaultCountry)
    : parseNumberList(parsed.data.entries.map((entry) => `${entry.label}, ${entry.phone}`).join("\n"), settings.defaultCountry);
  const blocked = await dncPhones(workspaceId);
  const allowed = list.entries.filter((entry) => !blocked.has(entry.phone));
  const added = await addCalls(allowed, settings.fromNumber, new Date(), null, workspaceId);

  return NextResponse.json({
    added: added.length,
    invalid: list.invalid,
    duplicates: list.duplicates,
    onDoNotCallList: list.entries.length - allowed.length,
  });
}
