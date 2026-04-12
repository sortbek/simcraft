import path from 'path';

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: process.env.DESKTOP_BUILD ? "export" : "standalone",
  outputFileTracingRoot: path.join(process.cwd(), '..'),
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000",
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
