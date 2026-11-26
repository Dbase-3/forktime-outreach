// A real app on a throwaway in-memory MongoDB (7.0, cached binary). Each test
// file gets its own database. `signIn` uses the dev code, as a person would.

import type { INestApplication } from "@nestjs/common";
import { MongoMemoryServer } from "mongodb-memory-server-core";
import request from "supertest";

export const DEV_CODE = "123456";

export async function startApp(): Promise<{ app: INestApplication; stop: () => Promise<void> }> {
  const mongo = await MongoMemoryServer.create({ binary: { version: "7.0.24" } });
  process.env.NODE_ENV = "test";
  process.env.MONGODB_URI = mongo.getUri("platform_test");
  process.env.DEV_LOGIN_CODE = DEV_CODE;
  process.env.RESEND_API_KEY = "";
  process.env.WORKER_IN_PROCESS = "false";
  process.env.JOBS_INLINE = "true"; // jobs run straight away, no Redis
  // Loaded after the environment is set, so the app reads these values.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createApp } = require("../src/app.factory") as typeof import("../src/app.factory");
  const app = await createApp();
  await app.init();
  return {
    app,
    stop: async () => {
      await app.close();
      await mongo.stop();
    },
  };
}

/** A supertest agent that keeps its session cookie, signed in as `email`. */
export async function signIn(app: INestApplication, email: string) {
  const agent = request.agent(app.getHttpServer());
  await agent.post("/auth/verify").send({ email, code: DEV_CODE }).expect(200);
  return agent;
}

/** Signs in and creates a workspace; returns the agent and the workspace path prefix. */
export async function withWorkspace(app: INestApplication, email: string, opts: { sample?: boolean; name?: string } = {}) {
  const agent = await signIn(app, email);
  const res = await agent.post("/workspaces").send({ name: opts.name ?? "Northside Motors", timezone: "Australia/Sydney", sample: opts.sample ?? false }).expect(201);
  return { agent, ws: `/w/${res.body.id}`, id: res.body.id as string };
}
