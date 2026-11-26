// Sends sign-in codes. With RESEND_API_KEY it emails through Resend; without
// one (local development) it writes the code to the log instead.

import { Inject, Injectable, Logger } from "@nestjs/common";
import { Resend } from "resend";
import { ENV, type Env } from "../../config/env";

@Injectable()
export class Mailer {
  private readonly log = new Logger("Mailer");
  private readonly resend: Resend | null;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;
  }

  async sendCode(email: string, code: string): Promise<void> {
    const subject = `${code} is your Forktime sign-in code`;
    const text = `Your sign-in code is ${code}. It works for 10 minutes.\n\nIf you didn't ask for it, you can ignore this email.`;
    if (!this.resend) {
      this.log.warn(`No RESEND_API_KEY: sign-in code for ${email} is ${code}`);
      return;
    }
    const { error } = await this.resend.emails.send({ from: this.env.EMAIL_FROM, to: email, subject, text });
    if (error) throw new Error(`Email failed: ${error.message}`);
  }

  async sendInvite(email: string, workspace: string, inviter: string): Promise<void> {
    const subject = `${inviter} invited you to ${workspace} on Forktime`;
    const text = `${inviter} invited you to the ${workspace} workspace.\n\nSign in with this email address to join: ${this.env.APP_URL}/sign-in`;
    if (!this.resend) {
      this.log.warn(`No RESEND_API_KEY: invite for ${email} to ${workspace}`);
      return;
    }
    const { error } = await this.resend.emails.send({ from: this.env.EMAIL_FROM, to: email, subject, text });
    if (error) throw new Error(`Email failed: ${error.message}`);
  }
}
