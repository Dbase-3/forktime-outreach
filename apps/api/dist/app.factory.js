"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createApp = createApp;
// Builds the HTTP app the same way for the server and for tests.
const core_1 = require("@nestjs/core");
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const nestjs_pino_1 = require("nestjs-pino");
const app_module_1 = require("./app.module");
async function createApp() {
    const app = await core_1.NestFactory.create(app_module_1.AppModule, { bufferLogs: true });
    app.useLogger(app.get(nestjs_pino_1.Logger));
    app.use((0, cookie_parser_1.default)());
    app.set("trust proxy", 1);
    app.useBodyParser("json", { limit: "16mb" });
    app.enableShutdownHooks();
    return app;
}
//# sourceMappingURL=app.factory.js.map