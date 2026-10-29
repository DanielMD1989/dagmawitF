'use server';

import { revalidatePath } from 'next/cache';
import { failure, success, typedIn, type ActionState } from '@/lib/action-state';
import { idField, isUuid } from '@/domain/form-input';
import { parseDone, parseHold, parseQuickAdd, parseRemaining } from '@/domain/day/forms';
import { isTaskStatus, takesHerTime, type ProgressChange } from '@/domain/day/progress';
import type { TaskStatus } from '@/domain/day/today';
import { isTaskKind } from '@/domain/planning/words';
import { missing, saveFailed } from '@/server/action-errors';
import { loadPreferences } from '@/server/preferences';
import { recordProgress } from '@/server/progress';
import { requireUser } from '@/server/session';
import { createSupabase } from '@/server/supabase';

// Every action does the same four things, in this order:
//   1. check who is asking  2. validate the input  3. write as her (row-level security applies)
//   4. refresh what the screens show

const CHECK_FIELDS = 'Check the fields marked below.';

type Supabase = Awaited<ReturnType<typeof createSupabase>>;

/** Writes a hold or a release to one task and says whether it was there to write to. */
async function setHold(
  supabase: Supabase,
  id: string,
  holdReason: string,
  typed: Record<string, string>,
  done: string,
): Promise<ActionState> {
  const { data, error } = await supabase
    .from('task')
    .update({ hold_reason: holdReason })
    .eq('id', id)
    .select('id');
  if (error) return saveFailed('the task', error, typed);
  if (data.length !== 1) return missing('task', typed);
  revalidatePath('/', 'layout');
  return success(done);
}

/** The task and the status the page showed it in (decision 0056), from a progress form. */
function taskAndSeen(formData: FormData): { id: string; seen: TaskStatus } | null {
  const id = idField(formData, 'id');
  const seen = formData.get('seen');
  return id && isTaskStatus(seen) ? { id, seen } : null;
}

/** Progress through the one function that records it (decision 0058), told in the form's words. */
async function progress(
  supabase: Supabase,
  task: { id: string; seen: TaskStatus },
  change: ProgressChange,
  typed: Record<string, string>,
  done: string,
): Promise<ActionState> {
  const { today } = await loadPreferences(supabase);
  const r = await recordProgress(supabase, { taskId: task.id, seen: task.seen, change, today });
  switch (r.result) {
    case 'applied':
      revalidatePath('/', 'layout');
      return success(done);
    case 'stale':
      // The page is behind: show it as it is now.
      revalidatePath('/', 'layout');
      return failure(r.message, {}, typed);
    case 'missing':
      return missing('task', typed);
    case 'invalid':
      return failure(r.message, {}, typed);
    case 'failed':
      return saveFailed('the task', r.error, typed);
  }
}

export async function startTask(_previous: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const typed = typedIn(formData);
  const task = taskAndSeen(formData);
  if (!task) return missing('task', typed);
  return progress(await createSupabase(), task, { kind: 'start' }, typed, 'Started.');
}

/** Done, on a day (today unless she says otherwise) and, for her own work, with the time it really took. */
export async function finishTask(_previous: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const typed = typedIn(formData);
  const task = taskAndSeen(formData);
  if (!task) return missing('task', typed);

  const supabase = await createSupabase();
  const found = await supabase.from('task').select('kind').eq('id', task.id).maybeSingle();
  if (found.error) return saveFailed('the task', found.error, typed);
  if (!found.data || !isTaskKind(found.data.kind)) return missing('task', typed);
  const prefs = await loadPreferences(supabase);
  const parsed = parseDone(formData, prefs.today, takesHerTime(found.data.kind));
  if (!parsed.ok) return failure(CHECK_FIELDS, parsed.errors, typed);

  return progress(supabase, task, { kind: 'done', ...parsed.value }, typed, 'Done.');
}

/** Still going: about how long is left. Starts the task if it was not. */
export async function keepGoing(_previous: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const typed = typedIn(formData);
  const task = taskAndSeen(formData);
  if (!task) return missing('task', typed);
  const parsed = parseRemaining(formData);
  if (!parsed.ok) return failure(CHECK_FIELDS, parsed.errors, typed);
  return progress(
    await createSupabase(),
    task,
    { kind: 'remaining', minutes: parsed.value },
    typed,
    'Saved. Tomorrow’s plan will give it the time that is left.',
  );
}

/** Not done after all: back to in progress, keeping that it was started. */
export async function reopenTask(_previous: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const typed = typedIn(formData);
  const task = taskAndSeen(formData);
  if (!task) return missing('task', typed);
  return progress(await createSupabase(), task, { kind: 'reopen' }, typed, 'Marked as not done.');
}

export async function holdTask(_previous: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const typed = typedIn(formData);
  const id = idField(formData, 'id');
  if (!id) return missing('task', typed);
  const parsed = parseHold(formData);
  if (!parsed.ok) return failure(CHECK_FIELDS, parsed.errors, typed);
  return setHold(
    await createSupabase(),
    id,
    parsed.value,
    typed,
    'On hold. The next plan leaves it out until you release it.',
  );
}

export async function releaseTask(_previous: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const typed = typedIn(formData);
  const id = idField(formData, 'id');
  if (!id) return missing('task', typed);
  return setHold(await createSupabase(), id, '', typed, 'Released.');
}

/** Work that came in the door: studio work, or a task for an open order's first garment (decision 0044). */
export async function quickAdd(_previous: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const typed = typedIn(formData);
  const parsed = parseQuickAdd(formData, isUuid);
  if (!parsed.ok) return failure(CHECK_FIELDS, parsed.errors, typed);

  const supabase = await createSupabase();
  let garmentId: string | null = null;
  if (parsed.value.orderId) {
    const first = await supabase
      .from('order_item')
      .select('id')
      .eq('order_id', parsed.value.orderId)
      .order('created_at')
      .limit(1);
    if (first.error) return saveFailed('the task', first.error, typed);
    garmentId = first.data[0]?.id ?? null;
    if (!garmentId) return failure(CHECK_FIELDS, { 'order-id': 'That order could not be found.' }, typed);
  }
  const { error } = await supabase.from('task').insert({
    order_id: parsed.value.orderId,
    order_item_id: garmentId,
    title: parsed.value.title,
    kind: 'work',
    minutes: parsed.value.minutes,
    sort: 100000,
  });
  if (error) return saveFailed('the task', error, typed);

  revalidatePath('/', 'layout');
  return success(`${parsed.value.title} added. The next plan gives it a day.`);
}

export async function removeQuickTask(_previous: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const typed = typedIn(formData);
  const id = idField(formData, 'id');
  if (!id) return missing('task', typed);
  const supabase = await createSupabase();
  const { data, error } = await supabase.from('task').delete().eq('id', id).is('order_id', null).select('id');
  if (error) return saveFailed('the task', error, typed);
  if (data.length !== 1) return missing('task', typed);
  revalidatePath('/', 'layout');
  return success('Removed.');
}
