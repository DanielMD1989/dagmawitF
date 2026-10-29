import type { Metadata } from 'next';
import { OfflineDay } from '@/components/offline/OfflineDay';

export const metadata: Metadata = { title: 'No signal' };

/**
 * My Day with no signal (docs/harden.md). The service worker keeps this page and sends her here when a page cannot
 * be reached; everything it shows was kept on the phone by My Day. It needs no session, and loads nothing.
 */
export default function OfflinePage() {
  return (
    <div className="shell">
      <main className="main main--alone" id="content">
        <p className="nav__brand nav__brand--alone">DAGMAWIT</p>
        <OfflineDay />
      </main>
    </div>
  );
}
