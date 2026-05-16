import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
    ],
  },
  async rewrites() {
    return [
      {
        source: "/kalptaru-residency-sample",
        destination: "/kalptaru-residency-sample/index.html",
      },
    ];
  },
};

export default nextConfig;
