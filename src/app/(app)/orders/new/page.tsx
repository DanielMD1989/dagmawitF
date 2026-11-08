import type { Metadata } from 'next';
import { CancelLink } from '@/components/BackLink';
import { asId } from '@/domain/form-input';
import { NO_CLIENT } from '@/domain/orders/forms';
import { usualSteps } from '@/domain/steps/usual';
import { loadClients } from '@/server/clients';
import { loadOrderHints } from '@/server/orders';
import { loadPreferences } from '@/server/preferences';
import { requireUser } from '@/server/session';
import { loadUsedStepTitles } from '@/server/steps';
import { createSupabase } from '@/server/supabase';
import { NewJobForm } from './NewJobForm';

export const metadata: Metadata = { title: 'New order or event' };

export default async function NewJobPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string; event?: string }>;
}) {
  await requireUser();
  const params = await searchParams;
  const supabase = await createSupabase();
  const [clients, hints, prefs, used] = await Promise.all([
    loadClients(supabase),
    loadOrderHints(supabase),
    loadPreferences(supabase),
    loadUsedStepTitles(supabase),
  ]);
  const wanted = asId(params.client);
  const initialClient = clients.some((c) => c.id === wanted)
    ? wanted
    : params.event === '1'
      ? NO_CLIENT
      : null;
  const event = initialClient === NO_CLIENT;

  return (
    <div className="form-screen">
      <div className="page-head">
        <CancelLink href={event ? '/events' : '/orders'} />
        <h1>{event ? 'New event' : 'New order'}</h1>
      </div>
      <NewJobForm
        clients={clients.map((c) => ({ id: c.id, name: c.name }))}
        initialClient={initialClient}
        usual={usualSteps(used)}
        today={prefs.today}
        nextNumber={hints.nextNumber}
        garmentTypes={hints.garmentTypes}
      />
    </div>
  );
}
