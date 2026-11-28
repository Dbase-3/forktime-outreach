import { Module } from "@nestjs/common";
import { NumbersModule } from "../numbers/numbers.module";
import { SampleService } from "./sample.service";
import { WorkspacesController } from "./workspaces.controller";
import { WorkspacesService } from "./workspaces.service";

@Module({ imports: [NumbersModule], controllers: [WorkspacesController], providers: [WorkspacesService, SampleService], exports: [SampleService] })
export class WorkspacesModule {}
