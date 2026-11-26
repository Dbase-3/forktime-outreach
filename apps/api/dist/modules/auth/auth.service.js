"use strict";
// Email sign-in with a 6-digit code (owner 2026-11-26: our own OTP, like
// forktime-core's local OTP). Codes and session tokens are stored only as
// hashes. Limits: 5 codes per email per 15 minutes, 20 per address per hour,
// 5 tries per code. A session is an opaque token in an httpOnly cookie.
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthService = void 0;
const common_1 = require("@nestjs/common");
const mongoose_1 = require("@nestjs/mongoose");
const node_crypto_1 = require("node:crypto");
const env_1 = require("../../config/env");
const errors_1 = require("../../common/errors");
const mailer_1 = require("./mailer");
const CODE_MINUTES = 10;
const SESSION_DAYS = 30;
const sha = (s) => (0, node_crypto_1.createHash)("sha256").update(s).digest("hex");
let AuthService = class AuthService {
    env;
    users;
    sessions;
    codes;
    invites;
    memberships;
    mailer;
    // A short in-memory cache so each request doesn't read the session from the database.
    cache = new Map();
    constructor(env, users, sessions, codes, invites, memberships, mailer) {
        this.env = env;
        this.users = users;
        this.sessions = sessions;
        this.codes = codes;
        this.invites = invites;
        this.memberships = memberships;
        this.mailer = mailer;
    }
    async requestCode(email, ip) {
        const since15 = new Date(Date.now() - 15 * 60_000);
        const sinceHour = new Date(Date.now() - 60 * 60_000);
        const [forEmail, forIp] = await Promise.all([this.codes.countDocuments({ email, createdAt: { $gte: since15 } }), this.codes.countDocuments({ ip, createdAt: { $gte: sinceHour } })]);
        if (forEmail >= 5 || forIp >= 20)
            throw (0, errors_1.tooMany)("That's a lot of codes. Wait a few minutes and try again.");
        const code = String((0, node_crypto_1.randomInt)(0, 1_000_000)).padStart(6, "0");
        await this.codes.create({ email, codeHash: sha(`${email}:${code}`), expiresAt: new Date(Date.now() + CODE_MINUTES * 60_000), ip });
        await this.mailer.sendCode(email, code);
    }
    /** Checks the code and opens a session. Returns the raw token for the cookie. */
    async verify(email, code, ip, userAgent) {
        const devOk = this.env.NODE_ENV !== "production" && this.env.DEV_LOGIN_CODE && code === this.env.DEV_LOGIN_CODE;
        if (!devOk) {
            const latest = await this.codes.findOne({ email, expiresAt: { $gt: new Date() } }).sort({ createdAt: -1 });
            if (!latest || latest.attempts >= 5)
                throw (0, errors_1.unprocessable)("That code has expired. Ask for a new one.");
            const want = Buffer.from(latest.codeHash, "hex");
            const got = Buffer.from(sha(`${email}:${code}`), "hex");
            if (want.length !== got.length || !(0, node_crypto_1.timingSafeEqual)(want, got)) {
                await this.codes.updateOne({ _id: latest._id }, { $inc: { attempts: 1 } });
                throw (0, errors_1.unprocessable)("That code isn't right. Check the email and try again.");
            }
            await this.codes.deleteMany({ email });
        }
        const user = await this.users.findOneAndUpdate({ email }, { $setOnInsert: { email }, $set: { lastSignInAt: new Date() } }, { upsert: true, new: true });
        await this.acceptInvites(email, user._id);
        const token = (0, node_crypto_1.randomBytes)(32).toString("base64url");
        await this.sessions.create({ tokenHash: sha(token), userId: user._id, expiresAt: new Date(Date.now() + SESSION_DAYS * 86_400_000), ip, userAgent: userAgent.slice(0, 300) });
        return { token, userId: user._id };
    }
    async acceptInvites(email, userId) {
        const open = await this.invites.find({ email, acceptedAt: null });
        for (const invite of open) {
            await this.memberships.updateOne({ workspaceId: invite.workspaceId, userId }, { $setOnInsert: { role: invite.role } }, { upsert: true });
            await this.invites.updateOne({ _id: invite._id }, { $set: { acceptedAt: new Date() } });
        }
    }
    async session(token) {
        if (!token)
            return null;
        const hash = sha(token);
        const hit = this.cache.get(hash);
        if (hit && hit.until > Date.now())
            return hit.ctx;
        const session = await this.sessions.findOne({ tokenHash: hash, expiresAt: { $gt: new Date() } }).lean();
        if (!session)
            return null;
        const user = await this.users.findById(session.userId).lean();
        if (!user)
            return null;
        const ctx = { userId: user._id, email: user.email, sessionId: session._id };
        this.cache.set(hash, { ctx, until: Date.now() + 30_000 });
        if (this.cache.size > 10_000)
            this.cache.clear();
        return ctx;
    }
    async logout(token) {
        if (!token)
            return;
        const hash = sha(token);
        this.cache.delete(hash);
        await this.sessions.deleteOne({ tokenHash: hash });
    }
    cookieOptions() {
        return { httpOnly: true, sameSite: "lax", secure: this.env.APP_URL.startsWith("https://"), path: "/", maxAge: SESSION_DAYS * 86_400_000 };
    }
};
exports.AuthService = AuthService;
exports.AuthService = AuthService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(env_1.ENV)),
    __param(1, (0, mongoose_1.InjectModel)("User")),
    __param(2, (0, mongoose_1.InjectModel)("Session")),
    __param(3, (0, mongoose_1.InjectModel)("LoginCode")),
    __param(4, (0, mongoose_1.InjectModel)("Invite")),
    __param(5, (0, mongoose_1.InjectModel)("Membership")),
    __metadata("design:paramtypes", [Object, Object, Object, Object, Object, Object, mailer_1.Mailer])
], AuthService);
//# sourceMappingURL=auth.service.js.map