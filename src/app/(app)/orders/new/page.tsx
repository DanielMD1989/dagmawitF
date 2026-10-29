import type { Metadata } from 'next';
import Link from 'next/link';
import { asId } from '@/domain/form-input';
import { loadClients } from '@/server/clients';
import { loadOrderHints } from '@/server/orders';
import { loadPreferences } from '@/server/preferences';
import { requireUser } from '@/server/session';
import { createSupabase } from '@/server/supabase';
import { NewOrderForm } from './NewOrderForm';

export const metadata: Metadata = { title: 'New order' };

export default async function NewOrderPage({ searchParams }: { searchParams: Promise<{ client?: string }> }) {
  await requireUser();
  const supabase = await createSupabase();
  const [clients, hints, prefs] = await Promise.all([
    loadClients(supabase),
    loadOrderHints(supabase),
    loadPreferences(supabase),
  ]);
  const wanted = asId((await searchParams).client);
  const initialClient = clients.some((c) => c.id === wanted) ? wanted : null;

  return (
    <>
      <div className="page-head">
        <p className="crumbs">
          <Link href="/orders">Orders</Link> / New
        </p>
        <h1>New order</h1>
        <p className="lede">
          Everything here can be changed later. Sketches, photos, measurements and what the order is waiting
          for come next, on the order itself.
        </p>
      </div>
      <NewOrderForm
        clients={clients.map((c) => ({ id: c.id, name: c.name }))}
        initialClient={initialClient}
        today={prefs.today}
        defaultBufferDays={prefs.defaultBufferDays}
        nextNumber={hints.nextNumber}
        garmentTypes={hints.garmentTypes}
      />
    </>
  );
}
