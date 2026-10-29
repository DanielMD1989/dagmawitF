'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { failure, success, typedIn, type ActionState } from '@/lib/action-state';
import { violates } from '@/lib/database-errors';
import { idField, isUuid } from '@/domain/form-input';
import {
  parseLink,
  parseTemplate,
  parseTemplateItem,
  parseTemplateTask,
  readNeeds,
  type TaskFields,
} from '@/domain/planning/forms';
import { missing, saveFailed } from '@/server/action-errors';
import { requireUser } from '@/server/session';
import { createSupabase } from '@/server/supabase';

// Every action does the same four things, in this order:
//   1. check who is asking  2. validate the input  3. write as her (row-level security applies)
//   4. refresh what the screens show

const CHECK_FIELDS = 'Check the fields marked below.';
const NAME_TAKEN = 'You already have a template with this name.';
const ITEM_TAKEN = 'This template already waits for an item with this name.';

const taskColumns = (t: TaskFields) => ({ title: t.title, kind: t.kind, minutes: t.minutes, days: t.days });

// ---------------------------------------------------------------------------------------------
// The template

export async function createTemplate(_previous: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const typed = typedIn(formData);
  const parsed = parseTemplate(formData);
  if (!parsed.ok) return failure(CHECK_FIELDS, parsed.errors, typed);

  const supabase = await createSupabase();
  const { data, error } = await supabase
    .from('template')
    .insert({ name: parsed.value.name, garment_type: parsed.value.garmentType, notes: parsed.value.notes })
    .select('id')
    .single();
  if (violates(error, 'template_name_key')) return failure(CHECK_FIELDS, { name: NAME_TAKEN }, typed);
  if (error) return saveFailed('the template', error, typed);

  revalidatePath('/', 'layout');
  redirect(`/library/${data.id}`);
}

export async function saveTemplate(_previous: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const typed = typedIn(formData);
  const id = idField(formData, 'id');
  if (!id) return missing('template', typed);
  const parsed = parseTemplate(formData);
  if (!parsed.ok) return failure(CHECK_FIELDS, parsed.errors, typed);

  const supabase = await createSupabase();
  const { data, error } = await supabase
    .from('template')
    .update({ name: parsed.value.name, garment_type: parsed.value.garmentType, notes: parsed.value.notes })
    .eq('id', id)
    .select('id');
  if (violates(error, 'template_name_key')) return failure(CHECK_FIELDS, { name: NAME_TAKEN }, typed);
  if (error) return saveFailed('the template', error, typed);
  if (data.length !== 1) return missing('template', typed);

  revalidatePath('/', 'layout');
  return success('Saved.');
}

/** Orders planned from it keep their copies (decision 0030). */
export async function deleteTemplate(_previous: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const typed = typedIn(formData);
  const id = idField(formData, 'id');
  if (!id) return missing('template', typed);

  const supabase = await createSupabase();
  const { data, error } = await supabase.from('template').delete().eq('id', id).select('id');
  if (error) return saveFailed('the template', error, typed);
  if (data.length !== 1) return missing('template', typed);

  revalidatePath('/', 'layout');
  redirect('/library');
}

// ---------------------------------------------------------------------------------------------
// Its tasks

export async function addTemplateTask(_previous: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const typed = typedIn(formData);
  const templateId = idField(formData, 'template-id');
  if (!templateId) return missing('template', typed);
  const parsed = parseTemplateTask(formData);
  if (!parsed.ok) return failure(CHECK_FIELDS, parsed.errors, typed);

  const supabase = await createSupabase();
  const last = await supabase
    .from('template_task')
    .select('sort')
    .eq('template_id', templateId)
    .order('sort', { ascending: false })
    .limit(1);
  if (last.error) return saveFailed('the task', last.error, typed);
  const sort = Math.min(100000, (last.data[0]?.sort ?? 0) + 10);

  const { error } = await supabase
    .from('template_task')
    .insert({ template_id: templateId, sort, ...taskColumns(parsed.value) });
  if (violates(error, 'template_task_template_fk')) return missing('template', typed);
  if (error) return saveFailed('the task', error, typed);

  revalidatePath('/', 'layout');
  return success(`${parsed.value.title} added.`);
}

export async function saveTemplateTask(_previous: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const typed = typedIn(formData);
  const id = idField(formData, 'id');
  if (!id) return missing('task', typed);
  const parsed = parseTemplateTask(formData);
  if (!parsed.ok) return failure(CHECK_FIELDS, parsed.errors, typed);

  const supabase = await createSupabase();
  const { data, error } = await supabase
    .from('template_task')
    .update(taskColumns(parsed.value))
    .eq('id', id)
    .select('id');
  if (error) return saveFailed('the task', error, typed);
  if (data.length !== 1) return missing('task', typed);

  revalidatePath('/', 'layout');
  return success('Saved.');
}

export async function removeTemplateTask(_previous: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const typed = typedIn(formData);
  const id = idField(formData, 'id');
  if (!id) return missing('task', typed);

  const supabase = await createSupabase();
  const { data, error } = await supabase.from('template_task').delete().eq('id', id).select('id');
  if (error) return saveFailed('the task', error, typed);
  if (data.length !== 1) return missing('task', typed);

  revalidatePath('/', 'layout');
  return success('Removed.');
}

// ---------------------------------------------------------------------------------------------
// Links between its tasks, and what each waits for

export async function addTemplateLink(_previous: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const typed = typedIn(formData);
  const templateId = idField(formData, 'template-id');
  const to = idField(formData, 'to');
  if (!templateId || !to) return missing('task', typed);
  const parsed = parseLink(formData, isUuid);
  if (!parsed.ok) return failure(CHECK_FIELDS, parsed.errors, typed);

  const supabase = await createSupabase();
  const { error } = await supabase.from('template_edge').insert({
    template_id: templateId,
    from_task: parsed.value.from,
    to_task: to,
    lag_days: parsed.value.lagDays,
  });
  if (error?.code === '23505') return failure('It already comes after that task.', {}, typed);
  if (violates(error, 'template_edge_from_fk') || violates(error, 'template_edge_to_fk'))
    return missing('task', typed);
  if (error) return saveFailed('the link', error, typed);

  revalidatePath('/', 'layout');
  return success('Linked.');
}

export async function removeTemplateLink(_previous: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const typed = typedIn(formData);
  const from = idField(formData, 'from');
  const to = idField(formData, 'to');
  if (!from || !to) return missing('link', typed);

  const supabase = await createSupabase();
  const { data, error } = await supabase
    .from('template_edge')
    .delete()
    .eq('from_task', from)
    .eq('to_task', to)
    .select('from_task');
  if (error) return saveFailed('the link', error, typed);
  if (data.length !== 1) return missing('link', typed);

  revalidatePath('/', 'layout');
  return success('Link removed.');
}

/** The items a task waits for: the ticked boxes replace what was there. */
export async function saveTemplateNeeds(_previous: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const typed = typedIn(formData);
  const templateId = idField(formData, 'template-id');
  const taskId = idField(formData, 'task-id');
  if (!templateId || !taskId) return missing('task', typed);
  const needs = readNeeds(formData, isUuid);

  const supabase = await createSupabase();
  // Two steps, each safe to repeat: if the second fails, saving again finishes the job.
  let removal = supabase.from('template_requires').delete().eq('task_id', taskId);
  if (needs.length > 0) removal = removal.not('prerequisite_id', 'in', `(${needs.join(',')})`);
  const removed = await removal;
  if (removed.error) return saveFailed('what the task waits for', removed.error, typed);
  if (needs.length > 0) {
    const { error } = await supabase.from('template_requires').upsert(
      needs.map((prerequisite_id) => ({ template_id: templateId, task_id: taskId, prerequisite_id })),
      { onConflict: 'task_id,prerequisite_id', ignoreDuplicates: true },
    );
    if (error) return saveFailed('what the task waits for', error, typed);
  }

  revalidatePath('/', 'layout');
  return success('Saved.');
}

// ---------------------------------------------------------------------------------------------
// What a garment of this kind waits for

export async function addTemplateItem(_previous: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const typed = typedIn(formData);
  const templateId = idField(formData, 'template-id');
  if (!templateId) return missing('template', typed);
  const parsed = parseTemplateItem(formData);
  if (!parsed.ok) return failure(CHECK_FIELDS, parsed.errors, typed);

  const supabase = await createSupabase();
  const { error } = await supabase.from('template_prerequisite').insert({
    template_id: templateId,
    kind: parsed.value.kind,
    label: parsed.value.label,
    blocking: parsed.value.blocking,
    sort: 100000,
  });
  if (violates(error, 'template_prerequisite_label_key'))
    return failure(CHECK_FIELDS, { label: ITEM_TAKEN }, typed);
  if (error) return saveFailed('the item', error, typed);

  revalidatePath('/', 'layout');
  return success(`${parsed.value.label} added.`);
}

export async function saveTemplateItem(_previous: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const typed = typedIn(formData);
  const id = idField(formData, 'id');
  if (!id) return missing('item', typed);
  const parsed = parseTemplateItem(formData);
  if (!parsed.ok) return failure(CHECK_FIELDS, parsed.errors, typed);

  const supabase = await createSupabase();
  const { data, error } = await supabase
    .from('template_prerequisite')
    .update({ kind: parsed.value.kind, label: parsed.value.label, blocking: parsed.value.blocking })
    .eq('id', id)
    .select('id');
  if (violates(error, 'template_prerequisite_label_key'))
    return failure(CHECK_FIELDS, { label: ITEM_TAKEN }, typed);
  if (error) return saveFailed('the item', error, typed);
  if (data.length !== 1) return missing('item', typed);

  revalidatePath('/', 'layout');
  return success('Saved.');
}

export async function removeTemplateItem(_previous: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const typed = typedIn(formData);
  const id = idField(formData, 'id');
  if (!id) return missing('item', typed);

  const supabase = await createSupabase();
  const { data, error } = await supabase.from('template_prerequisite').delete().eq('id', id).select('id');
  if (error) return saveFailed('the item', error, typed);
  if (data.length !== 1) return missing('item', typed);

  revalidatePath('/', 'layout');
  return success('Removed.');
}
