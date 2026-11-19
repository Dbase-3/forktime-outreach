import { SignJWT, jwtVerify } from "jose";

// The login session: a signed cookie. This file runs in the middleware too,
// so it uses nothing that needs Node.

export const SESSION_COOKIE = "fo_session";
export const SESSION_HOURS = 12;

function key(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET is not set, or shorter than 32 characters");
  return new TextEncoder().encode(secret);
}

export async function signSession(email: string): Promise<string> {
  return new SignJWT({ email })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_HOURS}h`)
    .sign(key());
}

/** The signed-in email, or null for a missing, altered or expired cookie. */
export async function readSession(token: string | undefined): Promise<string | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    return typeof payload.email === "string" ? payload.email : null;
  } catch {
    // Any verification failure means "not signed in".
    return null;
  }
}
