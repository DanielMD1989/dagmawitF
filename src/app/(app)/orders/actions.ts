'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { failure, typedIn, type ActionState } from '@/lib/action-state';
import { violates } from '@/lib/database-errors';
import { DELIVERY_STEP, parseNewJob } from '@/domain/orders/forms';
import type { StepFields } from '@/domain/steps/forms';
import { findClash, type Step } from '@/domain/steps/agenda';
import { clashMessage } from '@/domain/steps/words';
import { saveFailed } from '@/server/action-errors';
import { loadPreferences } from '@/server/preferences';
import { requireUser } from '@/server/session';
import { loadCalendarSteps } from '@/server/steps';
import { createSupabase } from '@/server/supabase';

// Every action does the same four things, in this order:
//   1. check who is asking  2. validate the input  3. write as her (row-level security applies)
//   4. refresh what the screens show

/**
 * Takes a job in one step (decision 0068): the client (new, existing, or none for an event), the job, a garment when it
 * is made for a client, and the steps she built with the days she gave them. A step's time already taken on her
 * calendar, or by another step of this job, is refused at that step (decision 0067).
 */
export async function createJob(_previous: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const typed = typedIn(formData);
  const supabase = await createSupabase();
  const prefs = await loadPreferences(supabase);
  const parsed = parseNewJob(formData, { today: prefs.today });
  if (!parsed.ok) return failure('Check the fields marked below.', parsed.errors, typed);
  const job = parsed.value;

  // Her steps, then the delivery at its time when she gave one (decision 0079).
  const steps: StepFields[] = job.deliveryAt
    ? [
        ...job.steps,
        { title: DELIVERY_STEP, onDay: job.dueOn, untilDay: null, startsAt: job.deliveryAt, endsAt: null },
      ]
    : job.steps;
  // A clash is said beside the field that holds the time: a step's, or the delivery's.
  const timeField = (i: number) => (i < job.steps.length ? `step-${i}-from` : 'due-at');

  if (steps.some((s) => s.startsAt)) {
    const taken: Step[] = await loadCalendarSteps(supabase, prefs.today);
    for (const [i, s] of steps.entries()) {
      const other = findClash(s, taken);
      if (other) return failure('That time is taken.', { [timeField(i)]: clashMessage(other) }, typed);
      // The steps before it on this form are on her calendar too, once saved.
      taken.push({ ...s, id: `new-${i}`, doneOn: null, job: null });
    }
  }

  const create = () =>
    supabase.rpc('create_job', {
      p_client_id: job.client.kind === 'existing' ? job.client.id : null,
      p_client_name: job.client.kind === 'new' ? job.client.name : null,
      p_client_phone: job.client.kind === 'new' ? job.client.phone : null,
      p_number: job.number,
      p_title: job.title,
      p_due_on: job.dueOn,
      p_notes: job.notes,
      p_brief: job.brief,
      p_steps: steps.map((s) => ({
        title: s.title,
        on_day: s.onDay,
        until_day: s.untilDay,
        starts_at: s.startsAt,
        ends_at: s.endsAt,
      })),
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
