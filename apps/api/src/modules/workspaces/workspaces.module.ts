import { Module } from "@nestjs/common";
import { SampleService } from "./sample.service";
import { WorkspacesController } from "./workspaces.controller";
import { WorkspacesService } from "./workspaces.service";

@Module({ controllers: [WorkspacesController], providers: [WorkspacesService, SampleService], exports: [SampleService] })
export class WorkspacesModule {}
