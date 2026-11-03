import type { NextConfig } from 'next';

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
];

const config: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  experimental: {
    // A picture is sent through a form action. Pictures are shrunk to well under 5 MB before they are sent, and
    // the largest accepted file is 5 MB, so a little more than that covers the form's other fields.
    serverActions: { bodySizeLimit: '6mb' },
  },
  // The list of measurements moved from Settings to Clients (decision 0093); an old link still finds it.
  async redirects() {
    return [{ source: '/settings/measurements', destination: '/clients/measurements', permanent: true }];
  },
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      // The service worker must always be re-checked, or an old one can stay for days.
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Content-Type', value: 'text/javascript; charset=utf-8' },
        ],
      },
    ];
  },
};

export default config;
