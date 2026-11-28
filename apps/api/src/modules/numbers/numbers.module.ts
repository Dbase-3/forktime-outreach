import { Module } from "@nestjs/common";
import { NumbersController } from "./numbers.controller";
import { SharedLine } from "./shared-line.service";

@Module({ controllers: [NumbersController], providers: [SharedLine], exports: [SharedLine] })
export class NumbersModule {}
