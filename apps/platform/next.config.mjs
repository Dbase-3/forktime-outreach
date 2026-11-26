/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The shared engine is TypeScript source (packages/core); Next compiles it with the app.
  transpilePackages: ["@outreach/core"],
  // "Flows" became "Agents" (2026-11-26): old links keep working.
  // The NestJS API (apps/api) is reached through this site's own address, so the
  // sign-in cookie stays first-party and there's no CORS. API_URL is server-side only.
  async rewrites() {
    return [{ source: "/api/v1/:path*", destination: `${process.env.API_URL ?? "http://localhost:4300"}/:path*` }];
  },
  async redirects() {
    return [
      { source: "/flows", destination: "/agents", permanent: true },
      { source: "/flows/:id", destination: "/agents/:id", permanent: true },
      { source: "/automations", destination: "/campaigns", permanent: false },
      { source: "/automations/:id", destination: "/campaigns", permanent: false },
    ];
  },
};

export default nextConfig;
