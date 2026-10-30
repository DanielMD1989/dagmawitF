'use server';

import { revalidatePath } from 'next/cache';
import { idField, text } from '@/domain/form-input';
import { findClash } from '@/domain/steps/agenda';
import { parseStep, type StepFields } from '@/domain/steps/forms';
import { clashMessage } from '@/domain/steps/words';
import { failure, success, typedIn, type ActionState } from '@/lib/action-state';
import { missing, saveFailed, unexpected } from '@/server/action-errors';
import { loadPreferences } from '@/server/preferences';
import { requireUser } from '@/server/session';
import { loadCalendarSteps, setDone } from '@/server/steps';
import { suggestFromTemplate } from '@/server/suggest';
import { createSupabase } from '@/server/supabase';

/** Steps of her jobs and her studio work (docs/calendar-first.md). Every change refreshes Today and the job. */

function refresh(orderId: string | null) {
  revalidatePath('/');
  revalidatePath('/calendar');
  revalidatePath('/orders');
  if (orderId) revalidatePath(`/orders/${orderId}`, 'layout');
}

/** The message for the field, when the step's time is already taken on her calendar (decision 0067). */
async function timeTaken(
  supabase: Awaited<ReturnType<typeof createSupabase>>,
  step: StepFields,
  stepId?: string,
): Promise<string | null> {
  if (!step.startsAt || !step.onDay) return null;
  const { today } = await loadPreferences(supabase);
  const other = findClash({ ...step, id: stepId }, await loadCalendarSteps(supabase, today));
  return other ? clashMessage(other) : null;
}

const columns = (s: StepFields) => ({
  title: s.title,
  on_day: s.onDay,
  until_day: s.untilDay,
  starts_at: s.startsAt,
  ends_at: s.endsAt,
});

/** Ticks a step done today, or opens it again: only if it is still as she saw it. */
export async function toggleStep(_previous: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const stepId = idField(formData, 'step-id');
  const orderId = idField(formData, 'order-id');
  if (!stepId) return failure('That step could not be found. Reload the page.');
  const sawDone = text(formData, 'saw-done') === 'true';
  const supabase = await createSupabase();
  const { today } = await loadPreferences(supabase);
  const r = await setDone(supabase, { stepId, sawDone, done: !sawDone, today });
  if (r.result === 'failed') return saveFailed('the step', r.error, {});
  refresh(orderId);
  if (r.result !== 'applied') return failure(r.message);
  return success(sawDone ? 'Opened again.' : 'Done.');
}

async function nextSort(
  supabase: Awaited<ReturnType<typeof createSupabase>>,
  orderId: string | null,
): Promise<number> {
  let query = supabase.from('task').select('sort').order('sort', { ascending: false }).limit(1);
  query = orderId ? query.eq('order_id', orderId) : query.is('order_id', null);
  const { data } = await query;
  const highest = (data?.[0] as { sort?: number } | undefined)?.sort ?? 0;
  return Math.min(100_000, highest + 10);
}

/** A new step: of a job when `order-id` is given, else her own studio work. */
export async function addStep(_previous: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const typed = typedIn(formData);
  const orderId = idField(formData, 'order-id');
  const parsed = parseStep(formData);
  if (!parsed.ok) return failure('Check the step.', parsed.errors, typed);
  const supabase = await createSupabase();
  const taken = await timeTaken(supabase, parsed.value);
  if (taken) return failure('That time is taken.', { from: taken }, typed);
  const { error } = await supabase
    .from('task')
    .insert({ order_id: orderId, sort: await nextSort(supabase, orderId), ...columns(parsed.value) });
  if (error) return saveFailed('the step', error, typed);
  refresh(orderId);
  return success(`Added “${parsed.value.title}”.`);
}

export async function saveStep(_previous: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const typed = typedIn(formData);
  const stepId = idField(formData, 'step-id');
  const orderId = idField(formData, 'order-id');
  if (!stepId) return failure('That step could not be found. Reload the page.', {}, typed);
  const parsed = parseStep(formData);
  if (!parsed.ok) return failure('Check the step.', parsed.errors, typed);
  const supabase = await createSupabase();
  const taken = await timeTaken(supabase, parsed.value, stepId);
  if (taken) return failure('That time is taken.', { from: taken }, typed);
  const { data, error } = await supabase
    .from('task')
    .update(columns(parsed.value))
    .eq('id', stepId)
    .select('id');
  if (error) return saveFailed('the step', error, typed);
  if (data.length === 0) return missing('step', typed);
  refresh(orderId);
  return success('Saved.');
}

export async function removeStep(_previous: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const stepId = idField(formData, 'step-id');
  const orderId = idField(formData, 'order-id');
  if (!stepId) return failure('That step could not be found. Reload the page.');
  const supabase = await createSupabase();
  const { data, error } = await supabase.from('task').delete().eq('id', stepId).select('id');
  if (error) return saveFailed('the step', error, {});
  if (data.length === 0) return missing('step', {});
  refresh(orderId);
  return success('Removed.');
}

/** Adds a template's steps to a job, on days counted back from its day, after any steps it has. */
export async function addTemplateSteps(_previous: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const typed = typedIn(formData);
  const orderId = idField(formData, 'order-id');
  const templateId = idField(formData, 'template');
  if (!orderId) return failure('That job could not be found. Reload the page.', {}, typed);
  if (!templateId) return failure('Choose the steps to add.', { template: 'Choose a template.' }, typed);
  const supabase = await createSupabase();
  const job = await supabase.from('orders').select('delivery_on').eq('id', orderId).maybeSingle();
  if (job.error) return unexpected('the steps', job.error, typed);
  if (!job.data) return missing('job', typed);
  const suggestion = await suggestFromTemplate(
    supabase,
    templateId,
    (job.data as { delivery_on: string }).delivery_on,
  );
  if (!suggestion) return failure('That template could not be found. Reload the page.', {}, typed);
  const start = await nextSort(supabase, orderId);
  const { error } = await supabase.from('task').insert(
    suggestion.steps.map((s, i) => ({
      order_id: orderId,
      sort: Math.min(100_000, start + i * 10),
      title: s.title,
      on_day: s.onDay,
      until_day: s.untilDay,
    })),
  );
  if (error) return saveFailed('the steps', error, typed);
  refresh(orderId);
  return success(
    `Added ${suggestion.steps.length} steps from “${suggestion.templateName}”.` +
      (suggestion.squeezed ? ' The day is near, so they were drawn closer together.' : ''),
  );
}
