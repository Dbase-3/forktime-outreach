// A local database for development, with no install: an embedded MongoDB on
// port 27027 whose data stays in apps/web/.data/mongo between runs.
// Production uses a real MongoDB through MONGODB_URI instead.
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MongoMemoryServer } from "mongodb-memory-server";

const dbPath = fileURLToPath(new URL("../.data/mongo", import.meta.url));
mkdirSync(dbPath, { recursive: true });

const server = await MongoMemoryServer.create({
  instance: { port: 27027, dbPath, storageEngine: "wiredTiger" },
});
console.log(`Local database ready: ${server.getUri()}forktime_outreach`);
console.log("Data is kept in apps/web/.data/mongo. Ctrl+C stops it.");

const stop = async () => {
  await server.stop({ doCleanup: false });
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
