// The job worker: same modules as the API, no HTTP. Runs imports and knowledge reading.
import "reflect-metadata";
// Local development reads apps/api/.env; production sets real environment variables.
try {
  process.loadEnvFile(".env");
} catch {
  // no .env: use the environment as it is
}
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { JobsService } from "./modules/jobs/jobs.service";

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule);
  app.enableShutdownHooks();
  app.get(JobsService).startWorker();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
