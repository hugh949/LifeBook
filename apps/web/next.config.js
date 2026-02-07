/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  reactStrictMode: true,
  async rewrites() {
    const upstream = process.env.API_UPSTREAM || "http://localhost:8000";
    return [{ source: "/api/:path*", destination: `${upstream}/:path*` }];
  },
};
module.exports = nextConfig;
