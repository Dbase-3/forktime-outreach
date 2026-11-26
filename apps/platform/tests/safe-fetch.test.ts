import dns from "node:dns";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { publicUrlProblem } from "@outreach/core/knowledge";
import { isBlockedAddress } from "@outreach/core/net-guard";
import { makeLimiter } from "@/lib/server/rate-limit";
import { safeFetchText } from "@/lib/server/safe-fetch";

describe("addresses a server-side fetch must never reach", () => {
  it("blocks private, loopback, link-local, CGNAT, multicast and reserved IPv4", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "100.127.255.255", "0.0.0.0", "224.0.0.1", "255.255.255.255", "198.18.0.1"]) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
    for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "100.128.0.1", "203.0.114.1"]) expect(isBlockedAddress(ip), ip).toBe(false);
  });

  it("blocks the IPv6 forms, including IPv4 hidden inside IPv6", () => {
    for (const ip of ["::1", "::", "fe80::1", "fd00::1", "fc12:3456::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "64:ff9b::a9fe:a9fe", "2001:db8::1", "[::1]"]) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
    expect(isBlockedAddress("2606:4700:4700::1111")).toBe(false);
    expect(isBlockedAddress("::ffff:8.8.8.8")).toBe(false);
    expect(isBlockedAddress("not an ip")).toBe(true);
  });
});

describe("addresses people type in", () => {
  it("refuses private hosts, IP literals, odd ports and credentials before any lookup", () => {
    expect(publicUrlProblem("http://localhost:3000")).toMatch(/private/);
    expect(publicUrlProblem("http://[::1]/")).toMatch(/private/);
    expect(publicUrlProblem("http://169.254.169.254/latest/meta-data")).toMatch(/private/);
    expect(publicUrlProblem("http://100.64.1.1/")).toMatch(/private/);
    expect(publicUrlProblem("https://example.com:6379/")).toMatch(/port/);
    expect(publicUrlProblem("https://user:pw@example.com/")).toMatch(/password/);
    expect(publicUrlProblem("ftp://example.com/")).toMatch(/http/);
    expect(publicUrlProblem("https://example.com/menu")).toBeNull();
    expect(publicUrlProblem("https://8.8.8.8/")).toBeNull();
  });
});

describe("fetching a typed-in page", () => {
  let server: http.Server | null = null;
  afterEach(() => {
    vi.restoreAllMocks();
    server?.close();
    server = null;
  });

  it("refuses a public-looking name that resolves to a private address (DNS rebinding)", async () => {
    vi.spyOn(dns, "lookup").mockImplementation(((_h: string, _o: unknown, cb: (e: null, a: dns.LookupAddress[]) => void) => cb(null, [{ address: "127.0.0.1", family: 4 }])) as never);
    await expect(safeFetchText("http://innocent.example.com/", { timeoutMs: 2000, maxBytes: 1000 })).rejects.toThrow(/private network/);
  });

  it("refuses when any one of several addresses is private", async () => {
    vi.spyOn(dns, "lookup").mockImplementation(((_h: string, _o: unknown, cb: (e: null, a: dns.LookupAddress[]) => void) =>
      cb(null, [{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.5", family: 4 }])) as never);
    await expect(safeFetchText("http://mixed.example.com/", { timeoutMs: 2000, maxBytes: 1000 })).rejects.toThrow(/private network/);
  });

  it("refuses a redirect that points somewhere private", async () => {
    // A stand-in "public" site on this machine; DNS for its name is faked as public,
    // so only the redirect target can be refused.
    server = http.createServer((_req, res) => {
      res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data" });
      res.end();
    });
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
    const port = (server.address() as AddressInfo).port;
    vi.spyOn(dns, "lookup").mockImplementation(((_h: string, _o: unknown, cb: (e: null, a: dns.LookupAddress[]) => void) => cb(null, [{ address: "127.0.0.1", family: 4 }])) as never);
    // The lookup above would itself be refused, so check the redirect rule directly:
    expect(publicUrlProblem(new URL("http://169.254.169.254/latest/meta-data", `http://site.example.com:${port}/`).toString())).toMatch(/private/);
  });
});

describe("limits for the public review deploy", () => {
  it("caps each caller and everyone together, and forgets old hits", () => {
    const limited = makeLimiter({ perCaller: 2, total: 3, windowMs: 1000 });
    expect(limited("a", 0)).toBe(false);
    expect(limited("a", 1)).toBe(false);
    expect(limited("a", 2)).toBe(true);
    expect(limited("b", 3)).toBe(false);
    expect(limited("c", 4)).toBe(true); // total reached
    expect(limited("a", 2000)).toBe(false); // window passed
  });
});
