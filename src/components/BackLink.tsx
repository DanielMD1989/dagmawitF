import Link from 'next/link';

/**
 * The way back from an inner page to the list it belongs to ("← Jobs"), at the top, large enough to tap. Installed on
 * a phone the app has no browser back button, so every inner page has one of these.
 */
export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <p className="back">
      <Link href={href} className="back-link">
        <span aria-hidden="true">← </span>
        {children}
      </Link>
    </p>
  );
}
