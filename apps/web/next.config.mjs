/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Server-only packages the bundler should leave alone.
  experimental: { serverComponentsExternalPackages: ["mongodb", "livekit-server-sdk"] },
};

export default nextConfig;
