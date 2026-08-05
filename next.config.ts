import type { NextConfig } from "next";

const isGitHubPages = process.env.GITHUB_ACTIONS === "true";
const basePath = isGitHubPages ? "/RebarViz" : "";

const nextConfig: NextConfig = {
  ...(isGitHubPages ? { output: "export" } : {}),
  basePath,
  assetPrefix: basePath,
  images: { unoptimized: true },
  reactCompiler: true,
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
