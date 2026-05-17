import path from 'path';

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: process.env.DESKTOP_BUILD ? "export" : "standalone",
  outputFileTracingRoot: path.join(process.cwd(), '..'),
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000",
  },
  async rewrites() {
    // In dev, the renderer loads from the Next dev server (localhost:3000) but
    // the backend runs separately. Forward /api/* to the backend so the renderer
    // can use window.location.origin uniformly across dev and production.
    // Skipped for the static export (DESKTOP_BUILD=1) — rewrites aren't supported
    // there, and production has the backend serving the frontend itself.
    if (process.env.DESKTOP_BUILD) return [];
    const target = process.env.NEXT_PUBLIC_DEV_BACKEND ?? "http://127.0.0.1:17384";
    return [
      { source: "/api/:path*", destination: `${target}/api/:path*` },
      // /health lives at the root, not under /api/ — used by the settings page
      // to discover available CPU thread count.
      { source: "/health", destination: `${target}/health` },
    ];
  },
  images: {
    unoptimized: !!process.env.DESKTOP_BUILD,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "render.worldofwarcraft.com",
        pathname: "/icons/**",
      },
    ],
  },
};

export default nextConfig;
