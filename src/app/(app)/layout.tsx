import { NavLinks } from '@/components/NavLinks';
import { OfflineSync } from '@/components/offline/OfflineSync';
import { requireUser } from '@/server/session';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="shell">
      <a href="#content" className="skip-link">
        Skip to the content
      </a>
      <nav className="nav" aria-label="Main">
        <div className="nav__brand">DAGMAWIT</div>
        <NavLinks />
      </nav>
      <main className="main" id="content" tabIndex={-1}>
        <OfflineSync ownerId={user.id} />
        {children}
      </main>
    </div>
  );
}
