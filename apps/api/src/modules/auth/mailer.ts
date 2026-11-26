// Sends sign-in codes. With RESEND_API_KEY it emails through Resend; without
// one (local development) it writes the code to the log instead.

import { Inject, Injectable, Logger } from "@nestjs/common";
import { Resend } from "resend";
import { ENV, type Env } from "../../config/env";
import { ApiError } from "../../common/errors";
import { codeEmail, inviteEmail, type Email } from "./emails";

@Injectable()
export class Mailer {
  private readonly log = new Logger("Mailer");
  private readonly resend: Resend | null;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;
  }

  /** Where the emails' images are served from: the live app, also for local sends (a mail app can't reach localhost). */
  private get assets(): string {
    return this.env.EMAIL_ASSETS_URL || this.env.APP_URL;
  }

  async sendCode(email: string, code: string): Promise<void> {
    if (!this.resend) {
      this.log.warn(`No RESEND_API_KEY: sign-in code for ${email} is ${code}`);
      return;
    }
    await this.send(email, codeEmail({ code, to: email, appUrl: this.assets }));
  }

  async sendInvite(email: string, workspace: string, inviter: string): Promise<void> {
    if (!this.resend) {
      this.log.warn(`No RESEND_API_KEY: invite for ${email} to ${workspace}`);
      return;
    }
    const m = inviteEmail({ to: email, workspace, inviter, appUrl: this.assets });
    // The button goes to this app's own sign-in, wherever it runs.
    await this.send(email, { ...m, html: m.html.split(`${this.assets.replace(/\/$/, "")}/sign-in`).join(`${this.env.APP_URL.replace(/\/$/, "")}/sign-in`) });
  }

  /** The email provider refused it (often a mistyped or unreachable address): say so plainly, log why. */
  private async send(to: string, m: Email): Promise<void> {
    const { error } = await this.resend!.emails.send({ from: this.env.EMAIL_FROM, to, subject: m.subject, html: m.html, text: m.text });
    if (!error) return;
    this.log.warn(`Email to ${to} refused: ${error.message}`);
    throw new ApiError(502, "email_failed", "We couldn't send an email to that address. Check it and try again.");
  }
}
