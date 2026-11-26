/** API tests: real MongoDB in memory (mongodb-memory-server-core), no network. */
module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/test"],
  testMatch: ["**/*.test.ts"],
  transform: { "^.+\\.ts$": ["ts-jest", { tsconfig: "tsconfig.json" }] },
  testTimeout: 30000,
  maxWorkers: 1,
};
