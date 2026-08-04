import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@snapline/shared", "@privy-io/react-auth", "@privy-io/wagmi"],
  webpack: (config) => {
    config.externals = config.externals || {};
    config.resolve = config.resolve || {};
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      net: false,
      tls: false,
    };
    return config;
  },
};

export default nextConfig;
