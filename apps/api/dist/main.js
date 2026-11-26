"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("reflect-metadata");
// Local development reads apps/api/.env; production sets real environment variables.
try {
    process.loadEnvFile(".env");
}
catch {
    // no .env: use the environment as it is
}
const app_factory_1 = require("./app.factory");
const env_1 = require("./config/env");
async function main() {
    const env = (0, env_1.loadEnv)();
    const app = await (0, app_factory_1.createApp)();
    await app.listen(env.PORT);
}
main().catch((err) => {
    console.error(err);
    process.exit(1);
});
//# sourceMappingURL=main.js.map