import "reflect-metadata";
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
