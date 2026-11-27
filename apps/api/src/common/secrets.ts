// Integration keys at rest: AES-256-GCM with INTEGRATIONS_KEY (32 bytes, hex or
// base64). The stored form is "v1:<iv>:<tag>:<data>" in base64url, so a key can
// be rotated later by version. Keys never leave the API: not in responses, not
// to the voice agent, not in logs.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const b64 = (b: Buffer) => b.toString("base64url");

export function secretKey(raw: string | undefined): Buffer | null {
  if (!raw) return null;
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  return key.length === 32 ? key : null;
}

export function seal(key: Buffer, plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", b64(iv), b64(cipher.getAuthTag()), b64(data)].join(":");
}

export function unseal(key: Buffer, sealed: string): string {
  const [v, iv, tag, data] = sealed.split(":");
  if (v !== "v1" || !iv || !tag || data === undefined) throw new Error("Unreadable secret");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}
