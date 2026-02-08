/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  reactStrictMode: true,
  // API proxy: do NOT use rewrites here. Rewrites are applied at BUILD time, so on
  // Azure the built app had destination localhost:8000 and /api/* always 500'd.
  // We use a runtime proxy in src/app/api/[...path]/route.ts (reads API_UPSTREAM per request).
};
module.exports = nextConfig;
