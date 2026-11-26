import { Controller, Get } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import type { Connection } from "mongoose";
import { Public } from "../common/decorators";

@Controller()
export class HealthController {
  constructor(@InjectConnection() private readonly db: Connection) {}

  @Public()
  @Get("healthz")
  health() {
    return { ok: this.db.readyState === 1 };
  }
}
