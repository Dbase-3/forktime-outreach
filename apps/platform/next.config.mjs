/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // "Flows" became "Agents" (2026-11-26): old links keep working.
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
