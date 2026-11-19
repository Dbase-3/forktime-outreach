import { NextResponse } from "next/server";
import { z } from "zod";
import { addCalls, listCalls, toCallJson } from "@/lib/calls-repo";
import { dncPhones } from "@/lib/dnc";
import { parseNumberList } from "@/lib/phone";
import { getSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ calls: (await listCalls()).map(toCallJson) });
}

const body = z.object({ numbers: z.string().min(1).max(100_000) });

/** Add a pasted list of numbers to the end of the queue. Nothing is dialled until Start. */
export async function POST(request: Request) {
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Paste at least one phone number." }, { status: 400 });

  const settings = await getSettings();
  const list = parseNumberList(parsed.data.numbers, settings.defaultCountry);
  const blocked = await dncPhones();
  const allowed = list.entries.filter((entry) => !blocked.has(entry.phone));
  const added = await addCalls(allowed, settings.fromNumber);

  return NextResponse.json({
    added: added.length,
    invalid: list.invalid,
    duplicates: list.duplicates,
    onDoNotCallList: list.entries.length - allowed.length,
  });
}
