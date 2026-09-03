import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: process.env.SITES_STATIC_EXPORT === "1" ? "export" : undefined,
  reactStrictMode: true,
};

export default nextConfig;
