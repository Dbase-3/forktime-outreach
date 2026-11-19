import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, readSession } from "@/lib/session";

// Everything needs a signed-in operator, except the login screen, the login
// call itself, and the voice agent's event intake (which has its own key).

const OPEN_PATHS = ["/login", "/api/auth/login", "/api/agent/events"];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (OPEN_PATHS.some((open) => pathname === open || pathname.startsWith(`${open}/`))) return NextResponse.next();

  const email = await readSession(request.cookies.get(SESSION_COOKIE)?.value);
  if (email) return NextResponse.next();

  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const login = request.nextUrl.clone();
  login.pathname = "/login";
  login.search = "";
  return NextResponse.redirect(login);
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
