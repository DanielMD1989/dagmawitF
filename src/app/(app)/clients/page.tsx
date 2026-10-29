import type { Metadata } from 'next';
import Link from 'next/link';
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
        <h1>The people she makes for</h1>
        <p className="lede">Name, phone and her measurements over time. Open one to see her orders.</p>
      </div>

      <div className="btn-row">
        <Link href="/clients/new" className="btn">
          Add a client
        </Link>
      </div>

      {clients.length === 0 ? (
        <div className="card">
          <p>No clients yet. A client is added here, or while entering her first order.</p>
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
                        : 'All delivered'
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
