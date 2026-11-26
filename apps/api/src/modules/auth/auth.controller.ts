import { Body, Controller, Get, HttpCode, Post, Req, Res } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { EmailSchema } from "@outreach/core/schemas";
import type { Request, Response } from "express";
import { z } from "zod";
import { Ctx, Public } from "../../common/decorators";
import { SESSION_COOKIE, type RequestContext } from "../../common/request";
import { parse } from "../../common/zod";
import type { M } from "../../db/models";
import { AuthService } from "./auth.service";

const ip = (req: Request) => (req.headers["x-real-ip"] as string) || req.ip || "unknown";

@Controller()
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @InjectModel("Membership") private readonly memberships: M<"Membership">,
    @InjectModel("Workspace") private readonly workspaces: M<"Workspace">,
    @InjectModel("User") private readonly users: M<"User">,
  ) {}

  /** Always answers the same, so it can't be used to find out who has an account. */
  @Public()
  @Post("auth/code")
  @HttpCode(200)
  async code(@Body() body: unknown, @Req() req: Request) {
    const { email } = parse(z.object({ email: EmailSchema }), body);
    await this.auth.requestCode(email, ip(req));
    return { sent: true };
  }

  @Public()
  @Post("auth/verify")
  @HttpCode(200)
  async verify(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { email, code } = parse(z.object({ email: EmailSchema, code: z.string().trim().regex(/^\d{6}$/, "The code is 6 digits.") }), body);
    const { token } = await this.auth.verify(email, code, ip(req), String(req.headers["user-agent"] ?? ""));
    res.cookie(SESSION_COOKIE, token, this.auth.cookieOptions());
    return { signedIn: true };
  }

  @Public()
  @Post("auth/logout")
  @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.cookies?.[SESSION_COOKIE]);
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    return { signedIn: false };
  }

  @Get("me")
  async me(@Ctx() ctx: RequestContext) {
    const [user, mine] = await Promise.all([this.users.findById(ctx.userId).lean(), this.memberships.find({ userId: ctx.userId }).lean()]);
    const spaces = await this.workspaces.find({ _id: { $in: mine.map((m) => m.workspaceId) } }, { name: 1 }).lean();
    return {
      user: { id: String(ctx.userId), email: ctx.email, name: user?.name ?? "" },
      workspaces: spaces.map((w) => ({ id: String(w._id), name: w.name, role: mine.find((m) => String(m.workspaceId) === String(w._id))?.role })),
    };
  }
}
