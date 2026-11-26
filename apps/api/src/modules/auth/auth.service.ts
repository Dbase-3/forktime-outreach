// Email sign-in with a 6-digit code (owner 2026-11-26: our own OTP, like
// forktime-core's local OTP). Codes and session tokens are stored only as
// hashes. Limits: 5 codes per email per 15 minutes, 20 per address per hour,
// 5 tries per code. A session is an opaque token in an httpOnly cookie.

import { Inject, Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import type { Types } from "mongoose";
import { ENV, type Env } from "../../config/env";
import { tooMany, unprocessable } from "../../common/errors";
import type { RequestContext } from "../../common/request";
import type { M } from "../../db/models";
import { Mailer } from "./mailer";

const CODE_MINUTES = 10;
const SESSION_DAYS = 30;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

@Injectable()
export class AuthService {
  // A short in-memory cache so each request doesn't read the session from the database.
  private readonly cache = new Map<string, { ctx: RequestContext; until: number }>();

  constructor(
    @Inject(ENV) private readonly env: Env,
    @InjectModel("User") private readonly users: M<"User">,
    @InjectModel("Session") private readonly sessions: M<"Session">,
    @InjectModel("LoginCode") private readonly codes: M<"LoginCode">,
    @InjectModel("Invite") private readonly invites: M<"Invite">,
    @InjectModel("Membership") private readonly memberships: M<"Membership">,
    private readonly mailer: Mailer,
  ) {}

  async requestCode(email: string, ip: string): Promise<void> {
    const since15 = new Date(Date.now() - 15 * 60_000);
    const sinceHour = new Date(Date.now() - 60 * 60_000);
    const [forEmail, forIp] = await Promise.all([this.codes.countDocuments({ email, createdAt: { $gte: since15 } }), this.codes.countDocuments({ ip, createdAt: { $gte: sinceHour } })]);
    if (forEmail >= 5 || forIp >= 20) throw tooMany("That's a lot of codes. Wait a few minutes and try again.");
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    await this.codes.create({ email, codeHash: sha(`${email}:${code}`), expiresAt: new Date(Date.now() + CODE_MINUTES * 60_000), ip });
    await this.mailer.sendCode(email, code);
  }

  /** Checks the code and opens a session. Returns the raw token for the cookie. */
  async verify(email: string, code: string, ip: string, userAgent: string): Promise<{ token: string; userId: Types.ObjectId }> {
    const devOk = this.env.NODE_ENV !== "production" && this.env.DEV_LOGIN_CODE && code === this.env.DEV_LOGIN_CODE;
    if (!devOk) {
      const latest = await this.codes.findOne({ email, expiresAt: { $gt: new Date() } }).sort({ createdAt: -1 });
      if (!latest || latest.attempts >= 5) throw unprocessable("That code has expired. Ask for a new one.");
      const want = Buffer.from(latest.codeHash, "hex");
      const got = Buffer.from(sha(`${email}:${code}`), "hex");
      if (want.length !== got.length || !timingSafeEqual(want, got)) {
        await this.codes.updateOne({ _id: latest._id }, { $inc: { attempts: 1 } });
        throw unprocessable("That code isn't right. Check the email and try again.");
      }
      await this.codes.deleteMany({ email });
    }
    const user = await this.users.findOneAndUpdate({ email }, { $setOnInsert: { email }, $set: { lastSignInAt: new Date() } }, { upsert: true, new: true });
    await this.acceptInvites(email, user._id);
    const token = randomBytes(32).toString("base64url");
    await this.sessions.create({ tokenHash: sha(token), userId: user._id, expiresAt: new Date(Date.now() + SESSION_DAYS * 86_400_000), ip, userAgent: userAgent.slice(0, 300) });
    return { token, userId: user._id };
  }

  private async acceptInvites(email: string, userId: Types.ObjectId): Promise<void> {
    const open = await this.invites.find({ email, acceptedAt: null });
    for (const invite of open) {
      await this.memberships.updateOne({ workspaceId: invite.workspaceId, userId }, { $setOnInsert: { role: invite.role } }, { upsert: true });
      await this.invites.updateOne({ _id: invite._id }, { $set: { acceptedAt: new Date() } });
    }
  }

  async session(token: string | undefined): Promise<RequestContext | null> {
    if (!token) return null;
    const hash = sha(token);
    const hit = this.cache.get(hash);
    if (hit && hit.until > Date.now()) return hit.ctx;
    const session = await this.sessions.findOne({ tokenHash: hash, expiresAt: { $gt: new Date() } }).lean();
    if (!session) return null;
    const user = await this.users.findById(session.userId).lean();
    if (!user) return null;
    const ctx: RequestContext = { userId: user._id, email: user.email, sessionId: session._id };
    this.cache.set(hash, { ctx, until: Date.now() + 30_000 });
    if (this.cache.size > 10_000) this.cache.clear();
    return ctx;
  }

  async logout(token: string | undefined): Promise<void> {
    if (!token) return;
    const hash = sha(token);
    this.cache.delete(hash);
    await this.sessions.deleteOne({ tokenHash: hash });
  }

  cookieOptions() {
    return { httpOnly: true, sameSite: "lax" as const, secure: this.env.APP_URL.startsWith("https://"), path: "/", maxAge: SESSION_DAYS * 86_400_000 };
  }
}
