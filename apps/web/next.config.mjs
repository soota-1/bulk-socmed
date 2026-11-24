/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@bulk-socmed/shared"],
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        crypto: false,
      };
    }
    return config;
  },
};

export default nextConfig;
