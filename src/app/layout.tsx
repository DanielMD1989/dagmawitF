import type { Metadata, Viewport } from 'next';
import { connection } from 'next/server';
import '@fontsource-variable/inter';
import './globals.css';
import { ServiceWorker } from '@/components/ServiceWorker';

export const metadata: Metadata = {
  title: { default: 'DAGMAWIT', template: '%s · DAGMAWIT' },
  description: 'Jobs, their steps and the calendar for one atelier.',
  applicationName: 'DAGMAWIT',
  appleWebApp: { capable: true, title: 'DAGMAWIT', statusBarStyle: 'default' },
  icons: {
    icon: [{ url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  formatDetection: { telephone: false },
};

// Always light for now (decision 0073); the browser's bar takes the page colour, --bg in globals.css.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#FAF8F5',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Every page is rendered for its request, never prebuilt: its scripts must carry this request's nonce, or the
  // Content-Security-Policy blocks them (decision 0059). A prebuilt page has no nonce to give.
  await connection();
  return (
    <html lang="en">
      <body>
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
