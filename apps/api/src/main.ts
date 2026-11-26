import "reflect-metadata";
// Local development reads apps/api/.env; production sets real environment variables.
try {
  process.loadEnvFile(".env");
} catch {
  // no .env: use the environment as it is
}
import { createApp } from "./app.factory";
import { loadEnv } from "./config/env";

async function main() {
  const env = loadEnv();
  const app = await createApp();
  await app.listen(env.PORT);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
