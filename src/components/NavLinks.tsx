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
  settings: (
    <path d="M4 7h10 M18 7h2 M4 17h2 M10 17h10 M16 5a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z M8 15a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z" />
  ),
};

// Five fit a phone's bar. With the Library gone (decision 0075), Clients takes its place there.
const LINKS = [
  { href: '/', label: 'Today', icon: 'day' },
  { href: '/calendar', label: 'Calendar', icon: 'planner' },
  { href: '/orders', label: 'Jobs', icon: 'orders' },
  { href: '/clients', label: 'Clients', icon: 'clients' },
  { href: '/settings', label: 'Settings', icon: 'settings' },
] as const;

export function NavLinks() {
  const pathname = usePathname();
  return (
    <>
      {LINKS.map(({ href, label, icon }) => {
        const current = href === '/' ? pathname === '/' : pathname.startsWith(href);
        return (
          <Link key={href} href={href} className="nav__link" aria-current={current ? 'page' : undefined}>
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
