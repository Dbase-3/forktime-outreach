import { NextResponse } from "next/server";
import { z } from "zod";
import { addDnc, listDnc, removeDnc } from "@/lib/dnc";
import { toE164 } from "@/lib/phone";
import { getSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const entries = await listDnc();
  return NextResponse.json({ entries: entries.map((e) => ({ ...e, addedAt: e.addedAt.toISOString() })) });
}

const addBody = z.object({ phone: z.string().min(3).max(40), reason: z.string().trim().max(200).optional() });

export async function POST(request: Request) {
  const parsed = addBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a phone number." }, { status: 400 });
  const phone = toE164(parsed.data.phone, (await getSettings()).defaultCountry);
  if (!phone) return NextResponse.json({ error: "That is not a phone number we can read." }, { status: 400 });
  await addDnc(phone, parsed.data.reason || "Added by hand");
  return NextResponse.json({ ok: true, phone });
}

const removeBody = z.object({ phone: z.string().min(3).max(40) });

export async function DELETE(request: Request) {
  const parsed = removeBody.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Which number?" }, { status: 400 });
  await removeDnc(parsed.data.phone);
  return NextResponse.json({ ok: true });
}
