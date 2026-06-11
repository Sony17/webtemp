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
        source: "/ondc/:path*",
        destination: "/api/ondc/:path*",
      },
      // ONDC registry fetches /ondc-site-verification.html to verify domain
      // ownership; map it to the dynamic route that signs the request_id.
      // (Next.js app router doesn't accept ".html" in segment names cleanly,
      // so we host it without the suffix and rewrite the URL.)
      {
        source: "/ondc-site-verification.html",
        destination: "/ondc-site-verification",
      },
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
      {
        source: "/merch_sample",
        destination: "/merch_sample/index.html",
      },
    ];
  },
};

export default nextConfig;
