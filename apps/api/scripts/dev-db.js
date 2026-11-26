// A local MongoDB for development without Docker: the same mongod binary the
// tests use (cached by mongodb-memory-server), as a single-node replica set,
// with data kept in apps/api/.data (git-ignored). Listens on 27018.
const fs = require("node:fs");
const path = require("node:path");
const { MongoMemoryReplSet } = require("mongodb-memory-server-core");

(async () => {
  const dbPath = path.join(__dirname, "..", ".data");
  fs.mkdirSync(dbPath, { recursive: true });
  const rs = await MongoMemoryReplSet.create({
    binary: { version: "7.0.24" },
    replSet: { count: 1, storageEngine: "wiredTiger" },
    instanceOpts: [{ port: 27018, dbPath }],
  });
  console.log(`MongoDB ready: ${rs.getUri("forktime_platform")}`);
  const stop = async () => {
    await rs.stop({ doCleanup: false });
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
})();
