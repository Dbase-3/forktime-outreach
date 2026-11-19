import { NextResponse } from "next/server";
import { z } from "zod";
import { clearLoginTries, credentialsMatch, loginAllowed, noteFailedLogin } from "@/lib/auth";
import { SESSION_COOKIE, SESSION_HOURS, signSession } from "@/lib/session";

export const runtime = "nodejs";

const body = z.object({ email: z.string().min(1).max(200), password: z.string().min(1).max(200) });

export async function POST(request: Request) {
  const address = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!loginAllowed(address)) {
    return NextResponse.json({ error: "Too many tries. Wait ten minutes and try again." }, { status: 429 });
  }
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !credentialsMatch(parsed.data.email, parsed.data.password)) {
    noteFailedLogin(address);
    return NextResponse.json({ error: "That email and password don't match." }, { status: 401 });
  }
  clearLoginTries(address);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, await signSession(parsed.data.email.trim().toLowerCase()), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_HOURS * 3600,
  });
  return response;
}
