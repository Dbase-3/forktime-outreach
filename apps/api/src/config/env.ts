// Settings from the environment, checked once at start-up. A bad or missing
// value stops the process with a clear message instead of failing later.

import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().default(4300),
  MONGODB_URI: z.string().min(1),
  REDIS_URL: z.string().default("redis://localhost:6379/3"),
  REDIS_PREFIX: z.string().default("platform"),
  APP_URL: z.string().url().default("http://localhost:3200"),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("Forktime <hello@forktime.ai>"),
  DEV_LOGIN_CODE: z.string().regex(/^\d{6}$/).optional().or(z.literal("")),
  WORKER_IN_PROCESS: z.string().optional(),
  ANTHROPIC_API_KEY_EVAL: z.string().optional(),
  // Voice calls (LiveKit). Unset: test calls say voice isn't set up here.
  LIVEKIT_URL: z.string().optional(),
  LIVEKIT_API_KEY: z.string().optional(),
  LIVEKIT_API_SECRET: z.string().optional(),
  /** The worker the API sends into a call's room (apps/platform-agent registers under it). */
  PLATFORM_AGENT_NAME: z.string().default("platform-agent-local"),
  /** Shared with apps/platform-agent: it signs every request to /runtime with it. */
  AGENT_RUNTIME_KEY: z.string().min(32).optional(),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Bad environment: ${problems}`);
  }
  const env = parsed.data;
  // A shared sign-in code is for local development only.
  if (env.NODE_ENV === "production" && env.DEV_LOGIN_CODE) throw new Error("DEV_LOGIN_CODE must not be set in production.");
  return env;
}

export const ENV = Symbol("ENV");
