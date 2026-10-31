import Link from 'next/link';

const ICONS = {
  add: <path d="M12 5v14 M5 12h14" />,
  event: (
    <path d="M4 5h16v15H4z M4 10h16 M8 3v4 M16 3v4 M12 13.5l1 2 2.2.3-1.6 1.5.4 2.2-2-1-2 1 .4-2.2-1.6-1.5 2.2-.3z" />
  ),
  month: <path d="M4 5h16v15H4z M4 10h16 M9 5v15 M14 5v15 M8 3v4 M16 3v4" />,
  upcoming: <path d="M12 7v5l3 2 M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Z" />,
  clients: (
    <path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z M2 21v-1a6 6 0 0 1 6-6h2a6 6 0 0 1 6 6v1 M17 3.2a4 4 0 0 1 0 7.6 M22 21v-1a6 6 0 0 0-4-5.7" />
  ),
};

export type QuickAction = { href: string; label: string; icon: keyof typeof ICONS };

/**
 * The page's main actions as green pill buttons with an icon, in a row that scrolls sideways on a narrow phone
 * (decision 0071: her FinTrack design's quick actions).
 */
export function QuickActions({ actions }: { actions: readonly QuickAction[] }) {
  return (
    <nav aria-label="Quick actions" className="actions">
      {actions.map((a) => (
        <Link key={a.href} href={a.href} className="action">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            {ICONS[a.icon]}
          </svg>
          {a.label}
        </Link>
      ))}
    </nav>
  );
}
