'use server';

import { revalidatePath } from 'next/cache';
import { failure, success, typedIn, type ActionState } from '@/lib/action-state';
import { idField, text } from '@/domain/form-input';
import { SUGGESTIONS, parsePrerequisite, type PrerequisiteFields } from '@/domain/orders/prerequisites';
import { missing, saveFailed } from '@/server/action-errors';
import { seeImpact, wantsImpact } from '@/server/propose';
import { requireUser } from '@/server/session';
import { createSupabase } from '@/server/supabase';

// Every action does the same four things, in this order:
//   1. check who is asking  2. validate the input  3. write as her (row-level security applies)
//   4. refresh what the screens show

const CHECK_FIELDS = 'Check the fields marked below.';

/** The item as the table stores it. */
const columns = (p: PrerequisiteFields) => ({
  kind: p.kind,
  label: p.label,
  state: p.state,
  expected_on: p.expectedOn,
  blocking: p.blocking,
  note: p.note,
});

export async function addPrerequisite(_previous: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const typed = typedIn(formData);
  const orderId = idField(formData, 'order-id');
  if (!orderId) return missing('order', typed);
  const parsed = parsePrerequisite(formData);
  if (!parsed.ok) return failure(CHECK_FIELDS, parsed.errors, typed);

  const supabase = await createSupabase();
  const { error } = await supabase
    .from('prerequisite')
    .insert({ order_id: orderId, ...columns(parsed.value) });
  if (error) return saveFailed('the item', error, typed);

  revalidatePath('/', 'layout');
  return success('Added to the list.');
}

/** One tap on a suggestion adds that item as Needed. */
export async function addSuggestion(_previous: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const typed = typedIn(formData);
  const orderId = idField(formData, 'order-id');
  if (!orderId) return missing('order', typed);
  const suggestion = SUGGESTIONS.find((s) => s.label === text(formData, 'suggestion'));
  if (!suggestion) return failure('That suggestion is no longer on the list.', {}, typed);

  const supabase = await createSupabase();
  const { error } = await supabase.from('prerequisite').insert({
    order_id: orderId,
    kind: suggestion.kind,
    label: suggestion.label,
    blocking: suggestion.blocking,
  });
  if (error) return saveFailed('the item', error, typed);

  revalidatePath('/', 'layout');
  return success(`${suggestion.label} added.`);
}

export async function savePrerequisite(_previous: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const typed = typedIn(formData);
  const id = idField(formData, 'id');
  if (!id) return missing('item', typed);
  const parsed = parsePrerequisite(formData);
  if (!parsed.ok) return failure(CHECK_FIELDS, parsed.errors, typed);

  const supabase = await createSupabase();
  const { data, error } = await supabase
    .from('prerequisite')
    .update(columns(parsed.value))
    .eq('id', id)
    .select('id');
  if (error) return saveFailed('the item', error, typed);
  if (data.length !== 1) return missing('item', typed);

  if (wantsImpact(formData)) return seeImpact(supabase, idField(formData, 'order-id'));
  revalidatePath('/', 'layout');
  return success('Saved.');
}

export async function removePrerequisite(_previous: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const typed = typedIn(formData);
  const id = idField(formData, 'id');
  if (!id) return missing('item', typed);

  const supabase = await createSupabase();
  const { data, error } = await supabase.from('prerequisite').delete().eq('id', id).select('id');
  if (error) return saveFailed('the item', error, typed);
  if (data.length !== 1) return missing('item', typed);

  revalidatePath('/', 'layout');
  return success('Removed from the list.');
}
