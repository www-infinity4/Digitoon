import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'export',
  basePath: process.env.GITHUB_PAGES ? '/Digitoon' : '',
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
