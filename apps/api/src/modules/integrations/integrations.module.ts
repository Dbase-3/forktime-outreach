import { Module } from "@nestjs/common";
import { ConnectionsService } from "./connections.service";
import { IntegrationsController } from "./integrations.controller";

@Module({ controllers: [IntegrationsController], providers: [ConnectionsService], exports: [ConnectionsService] })
export class IntegrationsModule {}
