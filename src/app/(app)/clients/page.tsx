import type { Metadata } from 'next';
import { AddLink, PageTitle } from '@/components/PageTitle';
import { loadClients } from '@/server/clients';
import { requireUser } from '@/server/session';
import { createSupabase } from '@/server/supabase';
import { ClientSearch } from './ClientSearch';

export const metadata: Metadata = { title: 'Clients' };

export default async function ClientsPage() {
  await requireUser();
  const clients = await loadClients(await createSupabase());

  return (
    <>
      <PageTitle title="Clients" action={<AddLink href="/clients/new" label="New client" />} />

      {clients.length === 0 ? (
        <div className="card">
          <p>No clients yet. A client is added here, or while taking her first order.</p>
        </div>
      ) : (
        <ClientSearch clients={clients} />
      )}
    </>
  );
}
