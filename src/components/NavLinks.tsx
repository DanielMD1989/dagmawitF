'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ICONS = {
  day: <path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z M12 3v2 M12 19v2 M3 12h2 M19 12h2" />,
  orders: (
    <path d="M8 4h8 M7 4h-1a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-1 M9 2h6v4H9z M8 12h8 M8 16h5" />
  ),
  clients: (
    <path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z M2 21v-1a6 6 0 0 1 6-6h2a6 6 0 0 1 6 6v1 M17 3.2a4 4 0 0 1 0 7.6 M22 21v-1a6 6 0 0 0-4-5.7" />
  ),
  planner: <path d="M4 5h16v15H4z M4 10h16 M9 5v15 M14 5v15 M8 3v4 M16 3v4" />,
  library: <path d="M4 19V5a2 2 0 0 1 2-2h12v16H6a2 2 0 0 0-2 2Zm0 0a2 2 0 0 0 2 2h12 M8 7h6 M8 11h6" />,
  settings: (
    <path d="M4 7h10 M18 7h2 M4 17h2 M10 17h10 M16 5a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z M8 15a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z" />
  ),
};

// Five fit a phone's bar; Clients is in the sidebar on wider screens and linked from Jobs (decision 0047).
const LINKS = [
  { href: '/', label: 'Today', icon: 'day', wideOnly: false },
  { href: '/calendar', label: 'Calendar', icon: 'planner', wideOnly: false },
  { href: '/orders', label: 'Jobs', icon: 'orders', wideOnly: false },
  { href: '/clients', label: 'Clients', icon: 'clients', wideOnly: true },
  { href: '/library', label: 'Library', icon: 'library', wideOnly: false },
  { href: '/settings', label: 'Settings', icon: 'settings', wideOnly: false },
] as const;

export function NavLinks() {
  const pathname = usePathname();
  return (
    <>
      {LINKS.map(({ href, label, icon, wideOnly }) => {
        const current = href === '/' ? pathname === '/' : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={wideOnly ? 'nav__link nav__link--wide' : 'nav__link'}
            aria-current={current ? 'page' : undefined}
          >
            <span className="nav__icon">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                {ICONS[icon]}
              </svg>
            </span>
            {label}
          </Link>
        );
      })}
    </>
  );
}
