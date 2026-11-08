import type { Metadata } from 'next';
import Link from 'next/link';
import { QuickActions } from '@/components/QuickActions';
import { loadClients } from '@/server/clients';
import { requireUser } from '@/server/session';
import { createSupabase } from '@/server/supabase';

export const metadata: Metadata = { title: 'Clients' };

export default async function ClientsPage() {
  await requireUser();
  const clients = await loadClients(await createSupabase());

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">Clients</p>
        <h1>Your clients</h1>
      </div>

      <QuickActions
        actions={[
          { href: '/clients/new', label: 'New client', icon: 'add' },
          // Her list of measurements and their unit (decision 0093): about her clients, so here, not in Settings.
          { href: '/clients/measurements', label: 'Measurements', icon: 'measure' },
        ]}
      />

      {clients.length === 0 ? (
        <div className="card">
          <p>No clients yet. A client is added here, or while taking her first order.</p>
        </div>
      ) : (
        <ul className="rows rows--links">
          {clients.map((c) => (
            <li key={c.id}>
              <Link href={`/clients/${c.id}`} className="row-link">
                <span className="row-link__title">{c.name}</span>
                <span className="hint">{c.phone || 'No phone saved'}</span>
                <span className="row-link__side">
                  <span className={c.openOrders > 0 ? 'chip' : 'chip chip--muted'}>
                    {c.openOrders === 0
                      ? c.orders === 0
                        ? 'No orders'
                        : 'All finished'
                      : `${c.openOrders} open ${c.openOrders === 1 ? 'order' : 'orders'}`}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
