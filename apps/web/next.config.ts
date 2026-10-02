import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets a second build or dev server run beside `next dev` (e.g. NEXT_DIST_DIR=.next-build).
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
