'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker (public/sw.js). It makes the app installable and shows a
 * friendly page when there is no signal. It does not store her data: see the file's comments.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((error: unknown) => {
      console.error('Service worker registration failed', error);
    });
  }, []);
  return null;
}
