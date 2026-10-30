import type { Metadata } from 'next';
import Link from 'next/link';
import { asId } from '@/domain/form-input';
import { isJobKind } from '@/domain/jobs/kinds';
import { loadClients } from '@/server/clients';
import { loadOrderHints } from '@/server/orders';
import { loadPreferences } from '@/server/preferences';
import { requireUser } from '@/server/session';
import { loadTemplates } from '@/server/steps';
import { createSupabase } from '@/server/supabase';
import { NewJobForm } from './NewJobForm';

export const metadata: Metadata = { title: 'New job' };

export default async function NewJobPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string; kind?: string }>;
}) {
  await requireUser();
  const params = await searchParams;
  const supabase = await createSupabase();
  const [clients, hints, prefs, templates] = await Promise.all([
    loadClients(supabase),
    loadOrderHints(supabase),
    loadPreferences(supabase),
    loadTemplates(supabase),
  ]);
  const wanted = asId(params.client);
  const initialClient = clients.some((c) => c.id === wanted) ? wanted : null;

  return (
    <>
      <div className="page-head">
        <p className="crumbs">
          <Link href="/orders">Jobs</Link> / New
        </p>
        <h1>New job</h1>
        <p className="lede">
          Its steps get their days on your calendar. Everything can be changed afterwards.
        </p>
      </div>
      <NewJobForm
        clients={clients.map((c) => ({ id: c.id, name: c.name }))}
        initialClient={initialClient}
        initialKind={isJobKind(params.kind) ? params.kind : 'new_order'}
        templates={templates.map((t) => ({ id: t.id, name: t.name, kind: t.kind, steps: t.steps.length }))}
        today={prefs.today}
        nextNumber={hints.nextNumber}
        garmentTypes={hints.garmentTypes}
      />
    </>
  );
}
