'use server';

import { revalidatePath } from 'next/cache';
import { failure, success, typedIn, type ActionState } from '@/lib/action-state';
import { violates } from '@/lib/database-errors';
import {
  isDirection,
  keyFromLabel,
  labelTaken,
  moveField,
  nextSort,
  parseFieldLabel,
} from '@/domain/measurements/fields';
import { idField, text } from '@/domain/form-input';
import { missing, saveFailed } from '@/server/action-errors';
import { loadMeasurementFields } from '@/server/measurements';
import { requireUser } from '@/server/session';
import { createSupabase } from '@/server/supabase';

// Every action does the same four things, in this order:
//   1. check who is asking  2. validate the input  3. write as her (row-level security applies)
//   4. refresh what the screens show

const NAME_TAKEN = 'You already have a measurement with this name.';

export async function addMeasurementField(_previous: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const typed = typedIn(formData);
  const label = parseFieldLabel(formData);
  if (!label.ok) return failure('Check the name.', label.errors, typed);

  const supabase = await createSupabase();
  const fields = await loadMeasurementFields(supabase);
  if (labelTaken(label.value, fields)) return failure('Check the name.', { label: NAME_TAKEN }, typed);

  const { error } = await supabase.from('measurement_field').insert({
    key: keyFromLabel(
      label.value,
      fields.map((f) => f.key),
    ),
    label: label.value,
    sort: nextSort(fields),
  });
  if (violates(error, 'measurement_field_visible_label'))
    return failure('Check the name.', { label: NAME_TAKEN }, typed);
  if (error) return saveFailed('the measurement', error, typed);

  revalidatePath('/', 'layout');
  return success(`${label.value} added.`);
}

export async function renameMeasurementField(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireUser();
  const typed = typedIn(formData);
  const id = idField(formData, 'id');
  if (!id) return missing('measurement', typed);
  const label = parseFieldLabel(formData);
  if (!label.ok) return failure('Check the name.', label.errors, typed);

  const supabase = await createSupabase();
  const fields = await loadMeasurementFields(supabase);
  if (labelTaken(label.value, fields, id)) return failure('Check the name.', { label: NAME_TAKEN }, typed);

  const { data, error } = await supabase
    .from('measurement_field')
    .update({ label: label.value })
    .eq('id', id)
    .select('id');
  if (violates(error, 'measurement_field_visible_label'))
    return failure('Check the name.', { label: NAME_TAKEN }, typed);
  if (error) return saveFailed('the measurement', error, typed);
  if (data.length !== 1) return missing('measurement', typed);

  revalidatePath('/', 'layout');
  return success('Saved.');
}

/** Hides a measurement from new forms, or shows it again. Saved measurements keep it either way. */
export async function setMeasurementFieldHidden(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireUser();
  const typed = typedIn(formData);
  const id = idField(formData, 'id');
  if (!id) return missing('measurement', typed);
  const hide = text(formData, 'hide') === 'yes';

  const supabase = await createSupabase();
  const { data, error } = await supabase
    .from('measurement_field')
    .update({ archived: hide })
    .eq('id', id)
    .select('id');
  if (violates(error, 'measurement_field_visible_label'))
    return failure('Another measurement already has this name. Rename one of them first.', {}, typed);
  if (error) return saveFailed('the measurement', error, typed);
  if (data.length !== 1) return missing('measurement', typed);

  revalidatePath('/', 'layout');
  return success(hide ? 'Hidden from new forms.' : 'Shown again.');
}

/** Moves a measurement one place up or down among the visible ones. */
export async function moveMeasurementField(_previous: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const typed = typedIn(formData);
  const id = idField(formData, 'id');
  const direction = text(formData, 'direction');
  if (!id || !isDirection(direction)) return missing('measurement', typed);

  const supabase = await createSupabase();
  const visible = (await loadMeasurementFields(supabase)).filter((f) => !f.archived).map((f) => f.id);
  const next = moveField(visible, id, direction);
  if (!next) return success('Saved.'); // already at the end: nothing to write

  const { error } = await supabase.rpc('reorder_measurement_fields', { p_ids: next });
  if (error) return saveFailed('the order of the measurements', error, typed);

  revalidatePath('/', 'layout');
  return success('Saved.');
}
