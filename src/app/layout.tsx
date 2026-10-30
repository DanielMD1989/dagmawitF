import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import '@fontsource-variable/inter';
import './globals.css';
import { ServiceWorker } from '@/components/ServiceWorker';
import { THEME_COLORS, THEME_COOKIE, parseTheme } from '@/lib/theme';

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

export async function generateViewport(): Promise<Viewport> {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return {
    width: 'device-width',
    initialScale: 1,
    viewportFit: 'cover',
    // With "follow my phone" the browser picks by its own setting; otherwise we know the answer.
    themeColor:
      theme === 'system'
        ? [
            { media: '(prefers-color-scheme: light)', color: THEME_COLORS.light },
            { media: '(prefers-color-scheme: dark)', color: THEME_COLORS.night },
          ]
        : THEME_COLORS[theme === 'night' ? 'night' : 'light'],
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html lang="en" data-theme={theme === 'system' ? undefined : theme}>
      <body>
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
