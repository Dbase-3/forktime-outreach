"use strict";
// Settings from the environment, checked once at start-up. A bad or missing
// value stops the process with a clear message instead of failing later.
Object.defineProperty(exports, "__esModule", { value: true });
exports.ENV = void 0;
exports.loadEnv = loadEnv;
const zod_1 = require("zod");
const EnvSchema = zod_1.z.object({
    NODE_ENV: zod_1.z.enum(["development", "test", "production"]).default("development"),
    PORT: zod_1.z.coerce.number().int().default(4300),
    MONGODB_URI: zod_1.z.string().min(1),
    REDIS_URL: zod_1.z.string().default("redis://localhost:6379/3"),
    REDIS_PREFIX: zod_1.z.string().default("platform"),
    APP_URL: zod_1.z.string().url().default("http://localhost:3200"),
    RESEND_API_KEY: zod_1.z.string().optional(),
    EMAIL_FROM: zod_1.z.string().default("Forktime <hello@forktime.ai>"),
    DEV_LOGIN_CODE: zod_1.z.string().regex(/^\d{6}$/).optional().or(zod_1.z.literal("")),
    WORKER_IN_PROCESS: zod_1.z.string().optional(),
    ANTHROPIC_API_KEY_EVAL: zod_1.z.string().optional(),
});
function loadEnv(source = process.env) {
    const parsed = EnvSchema.safeParse(source);
    if (!parsed.success) {
        const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
        throw new Error(`Bad environment: ${problems}`);
    }
    const env = parsed.data;
    // A shared sign-in code is for local development only.
    if (env.NODE_ENV === "production" && env.DEV_LOGIN_CODE)
        throw new Error("DEV_LOGIN_CODE must not be set in production.");
    return env;
}
exports.ENV = Symbol("ENV");
//# sourceMappingURL=env.js.map