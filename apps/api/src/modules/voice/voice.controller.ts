// Two doors. /w/:ws/…: the owner starts and ends a test call (signed in, a
// member). /runtime/…: the voice agent fetches a call's setup, searches its
// knowledge and reports the call. Those are @Public() for the session guard
// but every request must carry the agent's signature (RuntimeGuard).

import { Body, CanActivate, Controller, ExecutionContext, Get, HttpCode, Inject, Injectable, Param, Post, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { Types } from "mongoose";
import { z } from "zod";
import { Ctx, Public } from "../../common/decorators";
import { unauthorized } from "../../common/errors";
import { oid } from "../../common/ids";
import type { RequestContext } from "../../common/request";
import { NonceBook, SIGNATURE_HEADER, verifyRuntime } from "../../common/runtime-signature";
import { parse } from "../../common/zod";
import { ENV, type Env } from "../../config/env";
import { VoiceService } from "./voice.service";

@Injectable()
export class RuntimeGuard implements CanActivate {
  private readonly nonces = new NonceBook();
  constructor(@Inject(ENV) private readonly env: Env) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & { rawBody?: Buffer }>();
    const key = this.env.AGENT_RUNTIME_KEY;
    const path = req.originalUrl.split("?")[0];
    if (!key || !verifyRuntime(key, req.header(SIGNATURE_HEADER), req.method, path, req.rawBody ?? "", this.nonces)) throw unauthorized();
    return true;
  }
}

@Controller("w/:ws")
export class TestCallsController {
  constructor(private readonly voice: VoiceService) {}

  @Post("agents/:id/test-call")
  start(@Ctx() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    const { contactId } = parse(z.object({ contactId: z.string().max(64).nullable().default(null) }), body ?? {});
    return this.voice.startTest(ctx.workspaceId!, oid(id, "That agent"), { id: ctx.userId, email: ctx.email }, contactId);
  }

  /** Ring a real phone from the Lisna line with the agent's draft (owner 2026-11-28). */
  @Post("agents/:id/phone-call")
  phone(@Ctx() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    const o = parse(z.object({ to: z.string().trim().min(5).max(30), contactId: z.string().max(64).nullable().default(null) }), body ?? {});
    return this.voice.startPhone(ctx.workspaceId!, oid(id, "That agent"), { id: ctx.userId, email: ctx.email }, o);
  }

  @Post("calls/:id/hang-up")
  @HttpCode(200)
  hangUp(@Ctx() ctx: RequestContext, @Param("id") id: string) {
    return this.voice.hangUp(ctx.workspaceId!, oid(id, "That call"));
  }
}

@Public()
@UseGuards(RuntimeGuard)
@Controller("runtime/calls/:id")
export class RuntimeController {
  constructor(private readonly voice: VoiceService) {}

  @Get()
  setup(@Param("id") id: string) {
    return this.voice.runtimeConfig(callIdOf(id));
  }

  @Post("events")
  @HttpCode(200)
  events(@Param("id") id: string, @Body() body: unknown) {
    return this.voice.applyEvents(callIdOf(id), body);
  }

  @Post("calendar/times")
  @HttpCode(200)
  times(@Param("id") id: string, @Body() body: unknown) {
    return this.voice.freeTimes(callIdOf(id), body);
  }

  @Post("calendar/book")
  @HttpCode(200)
  book(@Param("id") id: string, @Body() body: unknown) {
    return this.voice.book(callIdOf(id), body);
  }

  @Post("calendar/mine")
  @HttpCode(200)
  mine(@Param("id") id: string, @Body() body: unknown) {
    return this.voice.myBookings(callIdOf(id), body);
  }

  @Post("calendar/change")
  @HttpCode(200)
  change(@Param("id") id: string, @Body() body: unknown) {
    return this.voice.changeBooking(callIdOf(id), body);
  }

  @Post("crm")
  @HttpCode(200)
  crm(@Param("id") id: string, @Body() body: unknown) {
    return this.voice.crmStep(callIdOf(id), body);
  }

  @Post("search")
  @HttpCode(200)
  search(@Param("id") id: string, @Body() body: unknown) {
    const { query } = parse(z.object({ query: z.string().min(1).max(300) }), body);
    return this.voice.search(callIdOf(id), query);
  }
}

const callIdOf = (id: string): Types.ObjectId => oid(id, "That call");
