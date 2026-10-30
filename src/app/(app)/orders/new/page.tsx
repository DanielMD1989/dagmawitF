import type { Metadata } from 'next';
import { BackLink } from '@/components/BackLink';
import { asId } from '@/domain/form-input';
import { NO_CLIENT } from '@/domain/orders/forms';
import { usualSteps } from '@/domain/steps/usual';
import { loadClients } from '@/server/clients';
import { loadOrderHints } from '@/server/orders';
import { loadPreferences } from '@/server/preferences';
import { requireUser } from '@/server/session';
import { loadTemplates, loadUsedStepTitles } from '@/server/steps';
import { createSupabase } from '@/server/supabase';
import { NewJobForm } from './NewJobForm';

export const metadata: Metadata = { title: 'New job or event' };

export default async function NewJobPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string; event?: string }>;
}) {
  await requireUser();
  const params = await searchParams;
  const supabase = await createSupabase();
  const [clients, hints, prefs, templates, used] = await Promise.all([
    loadClients(supabase),
    loadOrderHints(supabase),
    loadPreferences(supabase),
    loadTemplates(supabase),
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
    <>
      <div className="page-head">
        <BackLink href="/orders">Jobs</BackLink>
        <h1>{event ? 'New event' : 'New job'}</h1>
        <p className="lede">
          {event
            ? 'A bazaar, a fashion show: its name and its day.'
            : 'Who it is for, what it is, and the steps you will take, each on its day.'}
        </p>
      </div>
      <NewJobForm
        clients={clients.map((c) => ({ id: c.id, name: c.name }))}
        initialClient={initialClient}
        lists={templates
          .filter((t) => t.steps.length > 0)
          .map((t) => ({ id: t.id, name: t.name, steps: t.steps.map((s) => s.title) }))}
        usual={usualSteps(used)}
        today={prefs.today}
        nextNumber={hints.nextNumber}
        garmentTypes={hints.garmentTypes}
      />
    </>
  );
}
