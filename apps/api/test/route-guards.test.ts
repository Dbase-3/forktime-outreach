// Every route must be public on purpose, or belong to a workspace (/w/:ws/…),
// or be one of the few personal routes. A new controller that forgets this
// fails here (same idea as forktime-core's route-guards.spec).

import type { INestApplication } from "@nestjs/common";
import { DiscoveryService, MetadataScanner, Reflector } from "@nestjs/core";
import { PATH_METADATA } from "@nestjs/common/constants";
import { IS_PUBLIC } from "../src/common/decorators";
import { startApp } from "./helpers";

let app: INestApplication;
let stop: () => Promise<void>;
beforeAll(async () => ({ app, stop } = await startApp()));
afterAll(() => stop());

const PERSONAL = new Set(["/me", "/workspaces"]);
const PUBLIC = new Set(["/auth/code", "/auth/verify", "/auth/logout", "/healthz"]);
// The voice agent's door: public to the session guard, but each request must be signed (RuntimeGuard, tested in voice.test.ts).
const SIGNED = new Set(["/runtime/calls/:id", "/runtime/calls/:id/events", "/runtime/calls/:id/search"]);

it("every route is guarded by sign-in and, where it holds data, by workspace membership", () => {
  const discovery = app.get(DiscoveryService);
  const scanner = app.get(MetadataScanner);
  const reflector = app.get(Reflector);
  const routes: { path: string; isPublic: boolean }[] = [];
  for (const wrapper of discovery.getControllers()) {
    const instance = wrapper.instance as Record<string, unknown>;
    if (!instance || !wrapper.metatype) continue;
    const base = String(Reflect.getMetadata(PATH_METADATA, wrapper.metatype) ?? "").replace(/^\/|\/$/g, "");
    for (const name of scanner.getAllMethodNames(Object.getPrototypeOf(instance))) {
      const handler = instance[name] as object;
      const sub = Reflect.getMetadata(PATH_METADATA, handler);
      if (sub === undefined) continue;
      const path = "/" + [base, String(sub).replace(/^\/|\/$/g, "")].filter(Boolean).join("/");
      const isPublic = Boolean(reflector.getAllAndOverride(IS_PUBLIC, [handler as never, wrapper.metatype as never]));
      routes.push({ path, isPublic });
    }
  }
  expect(routes.length).toBeGreaterThan(10);
  const loose = routes.filter((r) => (r.isPublic ? !PUBLIC.has(r.path) && !SIGNED.has(r.path) : !(r.path.startsWith("/w/:ws") || PERSONAL.has(r.path))));
  expect(loose).toEqual([]);
});
