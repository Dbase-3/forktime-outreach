import { Module } from "@nestjs/common";
import { IntegrationsModule } from "../integrations/integrations.module";
import { ContactSyncService } from "./contact-sync.service";
import { SourcesController } from "./sources.controller";

@Module({ imports: [IntegrationsModule], controllers: [SourcesController], providers: [ContactSyncService], exports: [ContactSyncService] })
export class SourcesModule {}
