'use server';

import { changed } from '@/server/news';
import type { SupabaseClient } from '@supabase/supabase-js';
import { redirect } from 'next/navigation';
import { failure, success, typedIn, type ActionState } from '@/lib/action-state';
import { violates } from '@/lib/database-errors';
import { parseClient } from '@/domain/clients/forms';
import { idField } from '@/domain/form-input';
import { parseMeasurementSet } from '@/domain/measurements/sets';
import { isClosed } from '@/domain/orders/status';
import { missing, saveFailed, unexpected } from '@/server/action-errors';
import { loadMeasurementFields } from '@/server/measurements';
import { loadOrder } from '@/server/orders';
import { loadPreferences } from '@/server/preferences';
import { requireUser } from '@/server/session';
import { createSupabase } from '@/server/supabase';

// Every action does the same four things, in this order:
//   1. check who is asking  2. validate the input  3. write as her (row-level security applies)
//   4. refresh what the screens show

const CHECK_FIELDS = 'Check the fields marked below.';

export async function createClient(_previous: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const typed = typedIn(formData);
  const parsed = parseClient(formData);
  if (!parsed.ok) return failure(CHECK_FIELDS, parsed.errors, typed);

  const supabase = await createSupabase();
  const { data, error } = await supabase.from('client').insert(parsed.value).select('id').single();
  if (error) return saveFailed('the client', error, typed);

  changed('/', 'layout');
  redirect(`/clients/${String(data.id)}`);
}

export async function saveClient(_previous: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const typed = typedIn(formData);
  const id = idField(formData, 'id');
  if (!id) return missing('client', typed);
  const parsed = parseClient(formData);
  if (!parsed.ok) return failure(CHECK_FIELDS, parsed.errors, typed);

  const supabase = await createSupabase();
  const { data, error } = await supabase.from('client').update(parsed.value).eq('id', id).select('id');
  if (error) return saveFailed('the client', error, typed);
  if (data.length !== 1) return missing('client', typed);

  changed('/', 'layout');
  return success('Details saved.');
}

export async function deleteClient(_previous: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const typed = typedIn(formData);
  const id = idField(formData, 'id');
  if (!id) return missing('client', typed);

  const supabase = await createSupabase();
  const { data, error } = await supabase.from('client').delete().eq('id', id).select('id');
  if (violates(error, 'orders_client_fk')) {
    return failure(
      'This client has orders, so the client cannot be deleted. Orders are kept as a record.',
      {},
      typed,
    );
  }
  if (error) return unexpected('the client', error, typed);
  if (data.length !== 1) return missing('client', typed);

  changed('/', 'layout');
  redirect('/clients');
}

/**
 * Saves a new version of a client's measurements. When it is done from an order page (`order-id`), she goes
 * back to that order's measurements; otherwise to the client.
 *
 * From an order, the garments that have no measurements yet are made to this version: nothing is cut yet, and
 * asking her to pick the only version there is, garment by garment, is busywork. A garment that already has a
 * version keeps it, because it may be cut to those numbers; a newer version is offered, never applied.
 */
export async function recordMeasurements(_previous: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const typed = typedIn(formData);
  const clientId = idField(formData, 'client-id');
  if (!clientId) return missing('client', typed);
  const orderId = idField(formData, 'order-id');

  const supabase = await createSupabase();
  const [prefs, fields] = await Promise.all([loadPreferences(supabase), loadMeasurementFields(supabase)]);
  const parsed = parseMeasurementSet(
    formData,
    fields.filter((f) => !f.archived),
    prefs.today,
  );
  if (!parsed.ok) return failure(parsed.errors.form ?? CHECK_FIELDS, parsed.errors, typed);

  const { data: saved, error } = await supabase
    .from('measurement_set')
    .insert({
      client_id: clientId,
      taken_on: parsed.value.takenOn,
      unit: parsed.value.unit,
      measures: parsed.value.measures,
      note: parsed.value.note,
    })
    .select('id')
    .single();
  if (violates(error, 'measurement_set_one_version')) {
    return failure('These measurements were saved a moment ago. Open the client to see them.', {}, typed);
  }
  if (violates(error, 'measurement_set_client_fk')) return missing('client', typed);
  if (error) return saveFailed('the measurements', error, typed);

  if (orderId) await makeUnmeasuredGarmentsUse(supabase, orderId, clientId, saved.id);

  changed('/', 'layout');
  redirect(orderId ? `/orders/${orderId}/measurements` : `/clients/${clientId}`);
}

/**
 * The measurements are already saved, so nothing here may fail the form (she would send them twice): if it
 * does not work she lands on the order's measurements, which says which garments still have none chosen.
 */
async function makeUnmeasuredGarmentsUse(
  supabase: SupabaseClient,
  orderId: string,
  clientId: string,
  setId: string,
): Promise<void> {
  const order = await loadOrder(supabase, orderId);
  if (!order || order.client?.id !== clientId || isClosed(order.status)) return;
  const ids = order.garments.filter((g) => g.measurementSetId === null).map((g) => g.id);
  if (ids.length === 0) return;
  const { error } = await supabase.from('order_item').update({ measurement_set_id: setId }).in('id', ids);
  if (error)
    console.error(
      `Could not choose measurements for ${ids.length} garment(s) [${error.code}]: ${error.message}`,
    );
}
