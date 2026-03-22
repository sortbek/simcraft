/** @type {import('next').NextConfig} */
const nextConfig = {
  output: process.env.DESKTOP_BUILD ? "export" : "standalone",
  images: {
    unoptimized: !!process.env.DESKTOP_BUILD,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "wow.zamimg.com",
        pathname: "/images/wow/icons/**",
      },
    ],
  },
};

export default nextConfig;
