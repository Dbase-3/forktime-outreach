// POST /w/:ws/agents/:id/builder {message, history}: "Change with AI". Returns
// the changed draft (not saved), the changes in plain words, the AI's reply and
// anything that needs an integration that isn't connected.

import { Body, Controller, HttpCode, Param, Post } from "@nestjs/common";
import { Ctx } from "../../common/decorators";
import { oid } from "../../common/ids";
import type { RequestContext } from "../../common/request";
import { parse } from "../../common/zod";
import { BuilderBody, BuilderService } from "./builder.service";

@Controller("w/:ws/agents/:id/builder")
export class BuilderController {
  constructor(private readonly builder: BuilderService) {}

  @Post()
  @HttpCode(200)
  change(@Ctx() ctx: RequestContext, @Param("id") id: string, @Body() body: unknown) {
    return this.builder.change(ctx.workspaceId!, oid(id, "That agent"), parse(BuilderBody, body));
  }
}
