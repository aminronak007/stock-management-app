// Enable watchpack polling to prevent inotify EMFILE exhaustion in containerized environments
if (process.env.NODE_ENV !== 'production') {
  process.env.WATCHPACK_POLLING = 'true';
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  webpack: (config, { dev }) => {
    if (dev) {
      config.watchOptions = {
        poll: 1000,
        aggregateTimeout: 300,
        ignored: [
          '**/node_modules/**',
          '**/.next/**',
          '**/.git/**',
          '/home/hello/_/_/backend/**',
          '/home/hello/_/_/plans/**',
        ],
      };
    }
    return config;
  },
};

export default nextConfig;
