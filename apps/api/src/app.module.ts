import { Module } from "@nestjs/common";
import { DiscoveryModule } from "@nestjs/core";
import { LoggerModule } from "nestjs-pino";
import { CommonModule } from "./common/common.module";
import { ConfigModule } from "./config/config.module";
import { DbModule } from "./db/db.module";
import { AgentsModule } from "./modules/agents/agents.module";
import { AnalyticsModule } from "./modules/analytics/analytics.module";
import { CallsModule } from "./modules/calls/calls.module";
import { CampaignsModule } from "./modules/campaigns/campaigns.module";
import { ImportsModule } from "./modules/imports/imports.module";
import { IntegrationsModule } from "./modules/integrations/integrations.module";
import { JobsModule } from "./modules/jobs/jobs.module";
import { KnowledgeModule } from "./modules/knowledge/knowledge.module";
import { AuthModule } from "./modules/auth/auth.module";
import { ContactsModule } from "./modules/contacts/contacts.module";
import { FieldsModule } from "./modules/fields/fields.module";
import { NumbersModule } from "./modules/numbers/numbers.module";
import { HealthController } from "./modules/health.controller";
import { WorkspacesModule } from "./modules/workspaces/workspaces.module";

export const FEATURE_MODULES = [AuthModule, JobsModule, WorkspacesModule, AgentsModule, NumbersModule, FieldsModule, ContactsModule, KnowledgeModule, ImportsModule, CampaignsModule, CallsModule, AnalyticsModule, IntegrationsModule];

@Module({
  imports: [
    ConfigModule,
    DiscoveryModule, // lets test/route-guards.test.ts list every route
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.NODE_ENV === "test" ? "silent" : "info",
        transport: process.env.NODE_ENV === "development" ? { target: "pino-pretty", options: { singleLine: true } } : undefined,
        redact: ["req.headers.cookie", "res.headers['set-cookie']", "req.body.code"],
        autoLogging: { ignore: (req) => req.url === "/healthz" },
      },
    }),
    DbModule,
    CommonModule,
    ...FEATURE_MODULES,
  ],
  controllers: [HealthController],
})
export class AppModule {}
