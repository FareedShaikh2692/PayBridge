import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const API_URL = (process.env.API_URL ?? 'http://localhost:4000').replace(/\/$/, '');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@paybridge/shared'],
  outputFileTracingRoot: root,
  ...(process.env.NEXT_OUTPUT === 'standalone' ? { output: 'standalone' } : {}),
  // The browser only ever talks to this origin; the API is reached through this proxy. That keeps the
  // refresh cookie first-party (SameSite=Strict) and means no CORS in the normal path.
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${API_URL}/api/:path*` },
      { source: '/health/:path*', destination: `${API_URL}/health/:path*` },
    ];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-PayBridge-Sandbox', value: 'true' },
        ],
      },
    ];
  },
};

export default nextConfig;
