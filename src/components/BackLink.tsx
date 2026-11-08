import Link from 'next/link';

/**
 * The way back from an inner page to the list it belongs to ("‹ Orders"), at the top, large enough to tap. Installed on
 * a phone the app has no browser back button, so every inner page has one of these.
 */
export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <p className="back">
      <Link href={href} className="back-link">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m15 18-6-6 6-6" />
        </svg>
        {children}
      </Link>
    </p>
  );
}

/**
 * "Cancel", at the top left of a form that fills the screen (decision 0105): leaves it without saving, back to where
 * it was opened from.
 */
export function CancelLink({ href }: { href: string }) {
  return (
    <p className="back">
      <Link href={href} className="back-link">
        Cancel
      </Link>
    </p>
  );
}
