'use client';

import { forgetOffline } from '@/lib/offline-store';

/** Signing out also removes what My Day kept on the phone (docs/harden.md). */
export function SignOutForm({ action }: { action: () => Promise<void> }) {
  return (
    <form action={action} onSubmit={() => forgetOffline()}>
      <button type="submit" className="btn btn--quiet">
        Sign out
      </button>
    </form>
  );
}
