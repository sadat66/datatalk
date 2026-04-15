import type { NextConfig } from "next";

const distDir = process.env.NEXT_DIST_DIR?.trim();

const nextConfig: NextConfig = {
  ...(distDir ? { distDir } : {}),
};

export default nextConfig;
