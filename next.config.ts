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
      {
        source: "/demo-wallpaper",
        destination: "/demo-wallpaper/index.html",
      },
      {
        source: "/sample-caterer",
        destination: "/sample-caterer/index.html",
      },
      {
        source: "/electrical-sample",
        destination: "/electrical-sample/index.html",
      },
    ];
  },
};

export default nextConfig;
