// Sends sign-in codes. With RESEND_API_KEY it emails through Resend; without
// one (local development) it writes the code to the log instead.

import { Inject, Injectable, Logger } from "@nestjs/common";
import { Resend } from "resend";
import { ENV, type Env } from "../../config/env";
import { ApiError } from "../../common/errors";

@Injectable()
export class Mailer {
  private readonly log = new Logger("Mailer");
  private readonly resend: Resend | null;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;
  }

  async sendCode(email: string, code: string): Promise<void> {
    const subject = `${code} is your Lisna sign-in code`;
    const text = `Your sign-in code is ${code}. It works for 10 minutes.\n\nIf you didn't ask for it, you can ignore this email.`;
    if (!this.resend) {
      this.log.warn(`No RESEND_API_KEY: sign-in code for ${email} is ${code}`);
      return;
    }
    await this.send(email, subject, text);
  }

  async sendInvite(email: string, workspace: string, inviter: string): Promise<void> {
    const subject = `${inviter} invited you to ${workspace} on Lisna`;
    const text = `${inviter} invited you to the ${workspace} workspace.\n\nSign in with this email address to join: ${this.env.APP_URL}/sign-in`;
    if (!this.resend) {
      this.log.warn(`No RESEND_API_KEY: invite for ${email} to ${workspace}`);
      return;
    }
    await this.send(email, subject, text);
  }

  /** The email provider refused it (often a mistyped or unreachable address): say so plainly, log why. */
  private async send(to: string, subject: string, text: string): Promise<void> {
    const { error } = await this.resend!.emails.send({ from: this.env.EMAIL_FROM, to, subject, text });
    if (!error) return;
    this.log.warn(`Email to ${to} refused: ${error.message}`);
    throw new ApiError(502, "email_failed", "We couldn't send an email to that address. Check it and try again.");
  }
}
