"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// The job worker: same modules as the API, no HTTP. Runs imports and knowledge reading.
require("reflect-metadata");
// Local development reads apps/api/.env; production sets real environment variables.
try {
    process.loadEnvFile(".env");
}
catch {
    // no .env: use the environment as it is
}
const core_1 = require("@nestjs/core");
const app_module_1 = require("./app.module");
const jobs_service_1 = require("./modules/jobs/jobs.service");
async function main() {
    const app = await core_1.NestFactory.createApplicationContext(app_module_1.AppModule);
    app.enableShutdownHooks();
    app.get(jobs_service_1.JobsService).startWorker();
}
main().catch((err) => {
    console.error(err);
    process.exit(1);
});
//# sourceMappingURL=worker.js.map