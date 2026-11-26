"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = exports.FEATURE_MODULES = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const nestjs_pino_1 = require("nestjs-pino");
const common_module_1 = require("./common/common.module");
const config_module_1 = require("./config/config.module");
const db_module_1 = require("./db/db.module");
const agents_module_1 = require("./modules/agents/agents.module");
const analytics_module_1 = require("./modules/analytics/analytics.module");
const calls_module_1 = require("./modules/calls/calls.module");
const campaigns_module_1 = require("./modules/campaigns/campaigns.module");
const imports_module_1 = require("./modules/imports/imports.module");
const integrations_module_1 = require("./modules/integrations/integrations.module");
const jobs_module_1 = require("./modules/jobs/jobs.module");
const knowledge_module_1 = require("./modules/knowledge/knowledge.module");
const auth_module_1 = require("./modules/auth/auth.module");
const contacts_module_1 = require("./modules/contacts/contacts.module");
const fields_module_1 = require("./modules/fields/fields.module");
const numbers_module_1 = require("./modules/numbers/numbers.module");
const health_controller_1 = require("./modules/health.controller");
const workspaces_module_1 = require("./modules/workspaces/workspaces.module");
exports.FEATURE_MODULES = [auth_module_1.AuthModule, jobs_module_1.JobsModule, workspaces_module_1.WorkspacesModule, agents_module_1.AgentsModule, numbers_module_1.NumbersModule, fields_module_1.FieldsModule, contacts_module_1.ContactsModule, knowledge_module_1.KnowledgeModule, imports_module_1.ImportsModule, campaigns_module_1.CampaignsModule, calls_module_1.CallsModule, analytics_module_1.AnalyticsModule, integrations_module_1.IntegrationsModule];
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [
            config_module_1.ConfigModule,
            core_1.DiscoveryModule, // lets test/route-guards.test.ts list every route
            nestjs_pino_1.LoggerModule.forRoot({
                pinoHttp: {
                    level: process.env.NODE_ENV === "test" ? "silent" : "info",
                    transport: process.env.NODE_ENV === "development" ? { target: "pino-pretty", options: { singleLine: true } } : undefined,
                    redact: ["req.headers.cookie", "res.headers['set-cookie']", "req.body.code"],
                    autoLogging: { ignore: (req) => req.url === "/healthz" },
                },
            }),
            db_module_1.DbModule,
            common_module_1.CommonModule,
            ...exports.FEATURE_MODULES,
        ],
        controllers: [health_controller_1.HealthController],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map