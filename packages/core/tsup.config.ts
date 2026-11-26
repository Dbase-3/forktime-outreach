import { defineConfig } from "tsup";

// One CommonJS file per module, so `require("@outreach/core/campaign")` works in the
// NestJS API and the agent. Next.js reads the TypeScript source instead.
export default defineConfig({
  entry: ["src/*.ts"],
  format: ["cjs"],
  outDir: "dist",
  // .js (CommonJS, the package has no "type": "module"), so the compiled require("./types") resolves.
  bundle: false,
  splitting: false,
  sourcemap: true,
  clean: true,
  target: "node20",
});
