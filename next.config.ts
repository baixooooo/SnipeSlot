import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // node:sqlite is a Node built-in module used in server routes and worker
  serverExternalPackages: ["playwright"],
  experimental: {
    devtoolSegmentExplorer: false,
  },
};

export default nextConfig;
