'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { failure, success, typedIn, type ActionState } from '@/lib/action-state';
import { violates } from '@/lib/database-errors';
import { idField } from '@/domain/form-input';
import { parseTemplate, parseTemplateStep, type TemplateStepFields } from '@/domain/library/forms';
import { missing, saveFailed } from '@/server/action-errors';
import { requireUser } from '@/server/session';
import { createSupabase } from '@/server/supabase';

// Every action does the same four things, in this order:
//   1. check who is asking  2. validate the input  3. write as her (row-level security applies)
//   4. refresh what the screens show

const CHECK_FIELDS = 'Check the fields marked below.';
const NAME_TAKEN = 'You already have a template with this name.';

const stepColumns = (s: TemplateStepFields) => ({
  title: s.title,
  days_before: s.daysBefore,
  span_days: s.spanDays,
  with_client: s.withClient,
});

// ---------------------------------------------------------------------------------------------
// The template

export async function createTemplate(_previous: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const typed = typedIn(formData);
  const parsed = parseTemplate(formData);
  if (!parsed.ok) return failure(CHECK_FIELDS, parsed.errors, typed);

  const supabase = await createSupabase();
  const { data, error } = await supabase.from('template').insert(parsed.value).select('id').single();
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
  const { data, error } = await supabase.from('template').update(parsed.value).eq('id', id).select('id');
  if (violates(error, 'template_name_key')) return failure(CHECK_FIELDS, { name: NAME_TAKEN }, typed);
  if (error) return saveFailed('the template', error, typed);
  if (data.length !== 1) return missing('template', typed);

  revalidatePath('/', 'layout');
  return success('Saved.');
}

/** Jobs that took its steps keep them: they were copied (decision 0030). */
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
// Its steps

export async function addTemplateStep(_previous: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const typed = typedIn(formData);
  const templateId = idField(formData, 'template-id');
  if (!templateId) return missing('template', typed);
  const parsed = parseTemplateStep(formData);
  if (!parsed.ok) return failure(CHECK_FIELDS, parsed.errors, typed);

  const supabase = await createSupabase();
  const last = await supabase
    .from('template_task')
    .select('sort')
    .eq('template_id', templateId)
    .order('sort', { ascending: false })
    .limit(1);
  if (last.error) return saveFailed('the step', last.error, typed);
  const sort = Math.min(100000, ((last.data[0] as { sort?: number } | undefined)?.sort ?? 0) + 10);

  const { error } = await supabase
    .from('template_task')
    .insert({ template_id: templateId, sort, ...stepColumns(parsed.value) });
  if (violates(error, 'template_task_template_fk')) return missing('template', typed);
  if (error) return saveFailed('the step', error, typed);

  revalidatePath('/', 'layout');
  return success(`Added “${parsed.value.title}”.`);
}

export async function saveTemplateStep(_previous: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const typed = typedIn(formData);
  const id = idField(formData, 'id');
  if (!id) return missing('step', typed);
  const parsed = parseTemplateStep(formData);
  if (!parsed.ok) return failure(CHECK_FIELDS, parsed.errors, typed);

  const supabase = await createSupabase();
  const { data, error } = await supabase
    .from('template_task')
    .update(stepColumns(parsed.value))
    .eq('id', id)
    .select('id');
  if (error) return saveFailed('the step', error, typed);
  if (data.length !== 1) return missing('step', typed);

  revalidatePath('/', 'layout');
  return success('Saved.');
}

export async function removeTemplateStep(_previous: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const id = idField(formData, 'id');
  if (!id) return missing('step', {});
  const supabase = await createSupabase();
  const { data, error } = await supabase.from('template_task').delete().eq('id', id).select('id');
  if (error) return saveFailed('the step', error, {});
  if (data.length !== 1) return missing('step', {});
  revalidatePath('/', 'layout');
  return success('Removed.');
}
