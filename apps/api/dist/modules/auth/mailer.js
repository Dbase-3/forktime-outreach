"use strict";
// Sends sign-in codes. With RESEND_API_KEY it emails through Resend; without
// one (local development) it writes the code to the log instead.
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
exports.Mailer = void 0;
const common_1 = require("@nestjs/common");
const resend_1 = require("resend");
const env_1 = require("../../config/env");
let Mailer = class Mailer {
    env;
    log = new common_1.Logger("Mailer");
    resend;
    constructor(env) {
        this.env = env;
        this.resend = env.RESEND_API_KEY ? new resend_1.Resend(env.RESEND_API_KEY) : null;
    }
    async sendCode(email, code) {
        const subject = `${code} is your Forktime sign-in code`;
        const text = `Your sign-in code is ${code}. It works for 10 minutes.\n\nIf you didn't ask for it, you can ignore this email.`;
        if (!this.resend) {
            this.log.warn(`No RESEND_API_KEY: sign-in code for ${email} is ${code}`);
            return;
        }
        const { error } = await this.resend.emails.send({ from: this.env.EMAIL_FROM, to: email, subject, text });
        if (error)
            throw new Error(`Email failed: ${error.message}`);
    }
    async sendInvite(email, workspace, inviter) {
        const subject = `${inviter} invited you to ${workspace} on Forktime`;
        const text = `${inviter} invited you to the ${workspace} workspace.\n\nSign in with this email address to join: ${this.env.APP_URL}/sign-in`;
        if (!this.resend) {
            this.log.warn(`No RESEND_API_KEY: invite for ${email} to ${workspace}`);
            return;
        }
        const { error } = await this.resend.emails.send({ from: this.env.EMAIL_FROM, to: email, subject, text });
        if (error)
            throw new Error(`Email failed: ${error.message}`);
    }
};
exports.Mailer = Mailer;
exports.Mailer = Mailer = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(env_1.ENV)),
    __metadata("design:paramtypes", [Object])
], Mailer);
//# sourceMappingURL=mailer.js.map