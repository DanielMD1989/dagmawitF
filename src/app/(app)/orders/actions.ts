'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { failure, typedIn, type ActionState } from '@/lib/action-state';
import { violates } from '@/lib/database-errors';
import { parseNewJob } from '@/domain/orders/forms';
import { saveFailed } from '@/server/action-errors';
import { loadPreferences } from '@/server/preferences';
import { requireUser } from '@/server/session';
import { suggestFromTemplate } from '@/server/suggest';
import { createSupabase } from '@/server/supabase';

// Every action does the same four things, in this order:
//   1. check who is asking  2. validate the input  3. write as her (row-level security applies)
//   4. refresh what the screens show

/**
 * Takes a job in one step: the client (new or existing), the job, its garment if it has one, and its steps on the
 * days counted back from its day (decision 0066). She is taken to the job, where every day can be changed.
 */
export async function createJob(_previous: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const typed = typedIn(formData);
  const supabase = await createSupabase();
  const prefs = await loadPreferences(supabase);
  const parsed = parseNewJob(formData, { today: prefs.today });
  if (!parsed.ok) return failure('Check the fields marked below.', parsed.errors, typed);
  const job = parsed.value;

  let steps: { title: string; on_day: string; until_day: string | null; starts_at: string | null }[] = [];
  if (job.templateId) {
    const suggestion = await suggestFromTemplate(supabase, job.templateId, job.dueOn);
    if (!suggestion)
      return failure(
        'Check the fields marked below.',
        { template: 'That template could not be found.' },
        typed,
      );
    steps = suggestion.steps.map((s) => ({
      title: s.title,
      on_day: s.onDay,
      until_day: s.untilDay,
      // The time she gave is the time of what happens with the client on the day itself.
      starts_at: job.time && s.withClient && s.onDay === job.dueOn ? job.time : null,
    }));
  }

  const create = () =>
    supabase.rpc('create_job', {
      p_kind: job.kind,
      p_client_id: job.client.kind === 'existing' ? job.client.id : null,
      p_client_name: job.client.kind === 'new' ? job.client.name : null,
      p_client_phone: job.client.kind === 'new' ? job.client.phone : null,
      p_number: job.number,
      p_due_on: job.dueOn,
      p_notes: job.notes,
      p_garment_type: job.garment?.garmentType ?? null,
      p_brief: job.garment?.brief ?? '',
      p_steps: steps,
      p_confirm: true,
    });

  let result = await create();
  // Two jobs made in the same moment can be given the same next number. The second one is refused whole
  // (nothing was saved), so asking again takes the number after. A number she typed is never changed.
  if (violates(result.error, 'orders_number_key') && job.number === null) result = await create();

  if (result.error) {
    if (violates(result.error, 'orders_number_key'))
      return failure(
        'Check the fields marked below.',
        { number: 'Another job already has this number.' },
        typed,
      );
    if (violates(result.error, 'orders_client_fk'))
      return failure(
        'Check the fields marked below.',
        { client: 'That client could not be found. Choose another.' },
        typed,
      );
    return saveFailed('the job', result.error, typed);
  }

  const id = z.string().parse(result.data);
  revalidatePath('/', 'layout');
  redirect(`/orders/${id}`);
}
