'use client';

import { useEffect } from 'react';
import type { DaySnapshot } from '@/domain/steps/offline';
import { saveSnapshot } from '@/lib/offline-store';

/**
 * Keeps Today on the phone for when there is no signal (docs/harden.md), and asks the service worker to keep the
 * offline page up to date with this version of the app.
 */
export function SaveForOffline({ snapshot }: { snapshot: DaySnapshot }) {
  useEffect(() => {
    saveSnapshot(snapshot);
    navigator.serviceWorker?.controller?.postMessage({ type: 'refresh-offline' });
  }, [snapshot]);
  return null;
}
