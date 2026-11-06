'use server';

import { changed } from '@/server/news';
import { idField, text } from '@/domain/form-input';
import { findClash, isDeliveryStep, type Step } from '@/domain/steps/agenda';
import { parseLeftNote, parseStep, parseStepRows, sameStep, type StepFields } from '@/domain/steps/forms';
import { clashMessage } from '@/domain/steps/words';
import { failure, success, typedIn, type ActionState } from '@/lib/action-state';
import { missing, saveFailed } from '@/server/action-errors';
import { loadPreferences } from '@/server/preferences';
import { requireUser } from '@/server/session';
import { loadCalendarSteps, loadJobSteps, setDone, setPartDone } from '@/server/steps';
import { createSupabase } from '@/server/supabase';

/** Steps of her jobs and her studio work (docs/calendar-first.md). Every change refreshes Today and the job. */

function refresh(orderId: string | null) {
  changed('/');
  changed('/calendar');
  changed('/orders');
  if (orderId) changed(`/orders/${orderId}`, 'layout');
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
  // She has set its day herself: it is no longer a step moved over (decision 0080).
  moved_from: null,
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

/** Marks a step part done, with what is left (decision 0087); saying it again changes what is left. */
export async function markPartDone(_previous: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const typed = typedIn(formData);
  const stepId = idField(formData, 'step-id');
  const orderId = idField(formData, 'order-id');
  if (!stepId) return failure('That step could not be found. Reload the page.');
  const left = parseLeftNote(formData);
  if (!left.ok) return failure('Check what is left.', left.errors, typed);
  const supabase = await createSupabase();
  const { today } = await loadPreferences(supabase);
  const r = await setPartDone(supabase, { stepId, left: left.value, today });
  if (r.result === 'failed') return saveFailed('the step', r.error, typed);
  refresh(orderId);
  if (r.result !== 'applied') return failure(r.message);
  return success(`“${r.title}” is part done.`);
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
  // The same step twice on the same day of a job is one step added twice (her Task 6).
  if (orderId) {
    const twice = (await loadJobSteps(supabase, orderId)).find(
      (s) => s.doneOn === null && sameStep(s, parsed.value),
    );
    if (twice)
      return failure(
        'This step is already there.',
        { title: `This order already has “${twice.title}” on that day. Change that one instead.` },
        typed,
      );
  }
  const taken = await timeTaken(supabase, parsed.value);
  if (taken) return failure('That time is taken.', { from: taken }, typed);
  const { error } = await supabase
    .from('task')
    .insert({ order_id: orderId, sort: await nextSort(supabase, orderId), ...columns(parsed.value) });
  if (error) return saveFailed('the step', error, typed);
  refresh(orderId);
  return success(`Added “${parsed.value.title}”.`);
}

/**
 * Several steps added to an order at once, from the step buttons on its page (decision 0085): for an order taken in a
 * hurry, its steps are given afterwards. Each must not be there already on that day, nor take a time already taken;
 * a message is said beside its own row.
 */
export async function addSteps(_previous: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const typed = typedIn(formData);
  const orderId = idField(formData, 'order-id');
  if (!orderId) return failure('That order could not be found. Reload the page.', {}, typed);
  const rows = parseStepRows(formData);
  if (!rows.ok) return failure('Check the steps marked below.', rows.errors, typed);
  if (rows.value.length === 0) return failure('Tap a step first.', {}, typed);
  const supabase = await createSupabase();

  const existing = (await loadJobSteps(supabase, orderId)).filter((s) => s.doneOn === null);
  const errors: Record<string, string> = {};
  for (const [i, step] of rows.value.entries()) {
    // Its Delivery is there already, on its delivery day (decision 0096).
    if (isDeliveryStep(step.title)) {
      errors[`step-${i}-title`] = 'This order has its Delivery already. Change its day or time there.';
      continue;
    }
    const twice = existing.find((s) => sameStep(s, step));
    if (twice)
      errors[`step-${i}-title`] =
        `This order already has “${twice.title}” on that day. Change that one instead.`;
  }
  if (Object.keys(errors).length > 0) return failure('Some steps are already there.', errors, typed);

  if (rows.value.some((s) => s.startsAt)) {
    const { today } = await loadPreferences(supabase);
    const taken: Step[] = await loadCalendarSteps(supabase, today);
    for (const [i, step] of rows.value.entries()) {
      const other = findClash(step, taken);
      if (other) return failure('That time is taken.', { [`step-${i}-from`]: clashMessage(other) }, typed);
      taken.push({ ...step, id: `new-${i}`, doneOn: null, job: null });
    }
  }

  const start = await nextSort(supabase, orderId);
  const { error } = await supabase.from('task').insert(
    rows.value.map((step, i) => ({
      order_id: orderId,
      sort: Math.min(100_000, start + i * 10),
      ...columns(step),
    })),
  );
  if (error) return saveFailed('the steps', error, typed);
  refresh(orderId);
  const n = rows.value.length;
  return success(n === 1 ? `Added “${rows.value[0]!.title}”.` : `Added ${n} steps.`);
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
  // An order's Delivery is the delivery day (decision 0096): on a day, and not one that has passed.
  if (isDeliveryStep(parsed.value.title)) {
    const { today } = await loadPreferences(supabase);
    if (!parsed.value.onDay)
      return failure('Give the delivery its day.', { day: 'The delivery needs its day.' }, typed);
    if (parsed.value.onDay < today)
      return failure(
        'Choose a day that has not passed.',
        { day: 'The delivery day cannot be in the past.' },
        typed,
      );
  }
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
