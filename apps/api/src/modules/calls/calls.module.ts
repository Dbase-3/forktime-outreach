import { Module } from "@nestjs/common";
import { CallsController } from "./calls.controller";

@Module({ controllers: [CallsController], exports: [] })
export class CallsModule {}
