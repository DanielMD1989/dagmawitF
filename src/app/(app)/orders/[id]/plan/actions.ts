'use server';

import { revalidatePath } from 'next/cache';
import { failure, success, typedIn, type ActionState } from '@/lib/action-state';
import { violates } from '@/lib/database-errors';
import { idField, isUuid } from '@/domain/form-input';
import { parseLink, parseOrderTask, readNeeds, type OrderTaskFields } from '@/domain/planning/forms';
import { missing, saveFailed } from '@/server/action-errors';
import { seeImpact, wantsImpact } from '@/server/propose';
import { requireUser } from '@/server/session';
import { createSupabase } from '@/server/supabase';

// Every action does the same four things, in this order:
//   1. check who is asking  2. validate the input  3. write as her (row-level security applies)
//   4. refresh what the screens show

const CHECK_FIELDS = 'Check the fields marked below.';

const taskColumns = (t: OrderTaskFields) => ({
  title: t.title,
  kind: t.kind,
  minutes: t.minutes,
  days: t.days,
  fixed_on: t.fixedOn,
  fixed_time: t.fixedTime,
  not_before: t.notBefore,
  pinned_on: t.pinnedOn,
});

/** Copies a template into one garment (docs/planning.md, "Applying a template"). */
export async function applyTemplate(_previous: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const typed = typedIn(formData);
  const garmentId = idField(formData, 'garment-id');
  if (!garmentId) return missing('garment', typed);
  const templateId = idField(formData, 'template-id');
  if (!templateId) return failure(CHECK_FIELDS, { 'template-id': 'Choose a template.' }, typed);

  const supabase = await createSupabase();
  const { data, error } = await supabase.rpc('apply_template', {
    p_garment: garmentId,
    p_template: templateId,
  });
  if (error?.code === 'P0002') return missing('template or garment', typed);
  if (error) return saveFailed('the tasks', error, typed);

  revalidatePath('/', 'layout');
  return success(`${data} tasks added. Set the days of the fittings, then make a proposal.`);
}

/** Removes every task of one garment, to start again or apply another template. */
export async function clearGarmentTasks(_previous: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const typed = typedIn(formData);
  const garmentId = idField(formData, 'garment-id');
  if (!garmentId) return missing('garment', typed);

  const supabase = await createSupabase();
  const { error } = await supabase.from('task').delete().eq('order_item_id', garmentId);
  if (error) return saveFailed('the tasks', error, typed);

  revalidatePath('/', 'layout');
  return success('Tasks removed.');
}

export async function addTask(_previous: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const typed = typedIn(formData);
  const orderId = idField(formData, 'order-id');
  const garmentId = idField(formData, 'garment-id');
  if (!orderId || !garmentId) return missing('garment', typed);
  const parsed = parseOrderTask(formData);
  if (!parsed.ok) return failure(CHECK_FIELDS, parsed.errors, typed);

  const supabase = await createSupabase();
  const last = await supabase
    .from('task')
    .select('sort')
    .eq('order_id', orderId)
    .order('sort', { ascending: false })
    .limit(1);
  if (last.error) return saveFailed('the task', last.error, typed);
  const sort = Math.min(100000, (last.data[0]?.sort ?? 0) + 10);

  const { error } = await supabase
    .from('task')
    .insert({ order_id: orderId, order_item_id: garmentId, sort, ...taskColumns(parsed.value) });
  if (violates(error, 'task_garment_fk') || violates(error, 'task_order_fk'))
    return missing('garment', typed);
  if (error) return saveFailed('the task', error, typed);

  revalidatePath('/', 'layout');
  return success(`${parsed.value.title} added.`);
}

export async function saveTask(_previous: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const typed = typedIn(formData);
  const id = idField(formData, 'id');
  if (!id) return missing('task', typed);
  const parsed = parseOrderTask(formData);
  if (!parsed.ok) return failure(CHECK_FIELDS, parsed.errors, typed);

  const supabase = await createSupabase();
  const { data, error } = await supabase
    .from('task')
    .update(taskColumns(parsed.value))
    .eq('id', id)
    .select('id');
  if (error) return saveFailed('the task', error, typed);
  if (data.length !== 1) return missing('task', typed);

  if (wantsImpact(formData)) return seeImpact(supabase, idField(formData, 'order-id'));
  revalidatePath('/', 'layout');
  return success('Saved.');
}

export async function removeTask(_previous: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const typed = typedIn(formData);
  const id = idField(formData, 'id');
  if (!id) return missing('task', typed);

  const supabase = await createSupabase();
  const { data, error } = await supabase.from('task').delete().eq('id', id).select('id');
  if (error) return saveFailed('the task', error, typed);
  if (data.length !== 1) return missing('task', typed);

  revalidatePath('/', 'layout');
  return success('Removed.');
}

export async function addLink(_previous: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const typed = typedIn(formData);
  const orderId = idField(formData, 'order-id');
  const to = idField(formData, 'to');
  if (!orderId || !to) return missing('task', typed);
  const parsed = parseLink(formData, isUuid);
  if (!parsed.ok) return failure(CHECK_FIELDS, parsed.errors, typed);

  const supabase = await createSupabase();
  const { error } = await supabase
    .from('task_edge')
    .insert({ order_id: orderId, from_task: parsed.value.from, to_task: to, lag_days: parsed.value.lagDays });
  if (error?.code === '23505') return failure('It already comes after that task.', {}, typed);
  if (violates(error, 'task_edge_from_fk') || violates(error, 'task_edge_to_fk'))
    return missing('task', typed);
  if (error) return saveFailed('the link', error, typed);

  revalidatePath('/', 'layout');
  return success('Linked.');
}

export async function removeLink(_previous: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const typed = typedIn(formData);
  const from = idField(formData, 'from');
  const to = idField(formData, 'to');
  if (!from || !to) return missing('link', typed);

  const supabase = await createSupabase();
  const { data, error } = await supabase
    .from('task_edge')
    .delete()
    .eq('from_task', from)
    .eq('to_task', to)
    .select('from_task');
  if (error) return saveFailed('the link', error, typed);
  if (data.length !== 1) return missing('link', typed);

  revalidatePath('/', 'layout');
  return success('Link removed.');
}

/** The preparation items a task waits for: the ticked boxes replace what was there. */
export async function saveNeeds(_previous: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const typed = typedIn(formData);
  const orderId = idField(formData, 'order-id');
  const taskId = idField(formData, 'task-id');
  if (!orderId || !taskId) return missing('task', typed);
  const needs = readNeeds(formData, isUuid);

  const supabase = await createSupabase();
  // Two steps, each safe to repeat: if the second fails, saving again finishes the job.
  let removal = supabase.from('task_requires').delete().eq('task_id', taskId);
  if (needs.length > 0) removal = removal.not('prerequisite_id', 'in', `(${needs.join(',')})`);
  const removed = await removal;
  if (removed.error) return saveFailed('what the task waits for', removed.error, typed);
  if (needs.length > 0) {
    const { error } = await supabase.from('task_requires').upsert(
      needs.map((prerequisite_id) => ({ order_id: orderId, task_id: taskId, prerequisite_id })),
      { onConflict: 'task_id,prerequisite_id', ignoreDuplicates: true },
    );
    if (error) return saveFailed('what the task waits for', error, typed);
  }

  revalidatePath('/', 'layout');
  return success('Saved.');
}
