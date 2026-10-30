'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

const TABS = [
  { path: '', label: 'Steps' },
  { path: '/brief', label: 'Design brief' },
  { path: '/measurements', label: 'Measurements' },
  { path: '/history', label: 'History' },
] as const;

/** The pages of one job. */
export function OrderTabs({ orderId }: { orderId: string }) {
  const pathname = usePathname();
  const base = `/orders/${orderId}`;
  const bar = useRef<HTMLDivElement>(null);

  // On a narrow phone the tabs scroll sideways; keep the open one in sight, without moving the page.
  useEffect(() => {
    const el = bar.current;
    const current = el?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!el || !current) return;
    const left = current.offsetLeft - el.offsetLeft;
    if (left < el.scrollLeft || left + current.offsetWidth > el.scrollLeft + el.clientWidth)
      el.scrollLeft = left - 16;
  }, [pathname]);

  return (
    <nav aria-label="This job">
      <div className="tabs" ref={bar}>
        {TABS.map((tab) => {
          const href = `${base}${tab.path}`;
          return (
            <Link key={tab.path} href={href} aria-current={pathname === href ? 'page' : undefined}>
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
