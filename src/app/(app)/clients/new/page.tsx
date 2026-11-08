import type { Metadata } from 'next';
import { CancelLink } from '@/components/BackLink';
import { loadMeasurementFields } from '@/server/measurements';
import { loadPreferences } from '@/server/preferences';
import { requireUser } from '@/server/session';
import { createSupabase } from '@/server/supabase';
import { NewClientForm } from './NewClientForm';

export const metadata: Metadata = { title: 'New client' };

export default async function NewClientPage() {
  await requireUser();
  const supabase = await createSupabase();
  const [fields, prefs] = await Promise.all([loadMeasurementFields(supabase), loadPreferences(supabase)]);
  return (
    <div className="form-screen">
      <div className="page-head">
        <CancelLink href="/clients" />
        <h1>New client</h1>
      </div>
      <NewClientForm fields={fields.filter((f) => !f.archived)} unit={prefs.measurementUnit} />
    </div>
  );
}
