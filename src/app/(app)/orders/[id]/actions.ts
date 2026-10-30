'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { failure, success, typedIn, type ActionState } from '@/lib/action-state';
import { violates } from '@/lib/database-errors';
import { checkUpload, parseAttachmentDetails, parseCaption, storagePath } from '@/domain/files';
import { idField } from '@/domain/form-input';
import { parseGarment, parseOrderDetails, parseOrderNotes, parseTransition } from '@/domain/orders/forms';
import { isClosed, moveDone } from '@/domain/orders/status';
import { missing, saveFailed, unexpected } from '@/server/action-errors';
import { loadOrder } from '@/server/orders';
import { loadPreferences } from '@/server/preferences';
import { requireUser } from '@/server/session';
import { createSupabase } from '@/server/supabase';

// Every action does the same four things, in this order:
//   1. check who is asking  2. validate the input  3. write as her (row-level security applies)
//   4. refresh what the screens show

const CHECK_FIELDS = 'Check the fields marked below.';
const BUCKET = 'order-files';

// ---------------------------------------------------------------------------------------------
// The order itself

/**
 * Who it is for (or nobody: an event), what it is, the day and the notes. When the day moves and she asked for it, the steps not done yet move
 * by as many days, with the day itself, in one step. A delivered or cancelled job can only have its notes changed.
 */
export async function saveOrderDetails(_previous: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const typed = typedIn(formData);
  const id = idField(formData, 'id');
  if (!id) return missing('job', typed);

  const supabase = await createSupabase();
  const [order, prefs] = await Promise.all([loadOrder(supabase, id), loadPreferences(supabase)]);
  if (!order) return missing('job', typed);

  let patch: Record<string, unknown>;
  let moved: number | null = null;
  if (isClosed(order.status)) {
    const notes = parseOrderNotes(formData);
    if (!notes.ok) return failure(CHECK_FIELDS, notes.errors, typed);
    patch = { notes: notes.value };
  } else {
    const parsed = parseOrderDetails(formData, {
      status: order.status,
      dueOn: order.deliveryOn,
      today: prefs.today,
    });
    if (!parsed.ok) return failure(CHECK_FIELDS, parsed.errors, typed);
    const details = parsed.value;
    if (details.dueOn !== order.deliveryOn && details.moveSteps) {
      const r = await supabase.rpc('move_due_day', {
        p_order_id: id,
        p_due_on: details.dueOn,
        p_move_steps: true,
      });
      if (r.error) return saveFailed('the job', r.error, typed);
      moved = Number(r.data);
    }
    patch = {
      client_id: details.clientId,
      title: details.title,
      delivery_on: details.dueOn,
      notes: details.notes,
    };
  }

  // Only if the job is still in the status this form was shown for: another window may have changed it.
  const { data, error } = await supabase
    .from('orders')
    .update(patch)
    .eq('id', id)
    .eq('status', order.status)
    .select('id');
  if (violates(error, 'orders_client_fk'))
    return failure(CHECK_FIELDS, { client: 'That client could not be found. Choose another.' }, typed);
  if (error) return saveFailed('the job', error, typed);
  if (data.length !== 1)
    return failure('This job was changed in another window. Reload the page and try again.', {}, typed);

  revalidatePath('/', 'layout');
  return success(
    moved === null ? 'Saved.' : `Saved. ${moved} step${moved === 1 ? '' : 's'} moved with the day.`,
  );
}

/** Moves the order to another status: confirm, put on hold, resume, deliver, cancel, reopen. */
export async function moveOrder(_previous: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const typed = typedIn(formData);
  const id = idField(formData, 'id');
  if (!id) return missing('order', typed);

  const supabase = await createSupabase();
  const [order, prefs] = await Promise.all([loadOrder(supabase, id), loadPreferences(supabase)]);
  if (!order) return missing('order', typed);

  const parsed = parseTransition(formData, order.status, {
    today: prefs.today,
    deliveryOn: order.deliveryOn,
  });
  if (!parsed.ok) return failure(parsed.errors.form ?? CHECK_FIELDS, parsed.errors, typed);
  const move = parsed.value;

  const patch: Record<string, unknown> = { status: move.to };
  if (move.deliveryOn !== undefined) patch.delivery_on = move.deliveryOn;
  if (move.holdReason !== undefined) patch.hold_reason = move.holdReason;
  if (move.cancelReason !== undefined) patch.cancel_reason = move.cancelReason;
  if (move.deliveredOn !== undefined) patch.delivered_on = move.deliveredOn;

  const { data, error } = await supabase
    .from('orders')
    .update(patch)
    .eq('id', id)
    .eq('status', order.status)
    .select('id');
  if (error) return saveFailed('the order', error, typed);
  if (data.length !== 1)
    return failure('This order was changed in another window. Reload the page and try again.', {}, typed);

  revalidatePath('/', 'layout');
  return success(moveDone(order.status, move.to));
}

/**
 * Deletes a job made by mistake, whatever its state (she asked for this): its garments, steps, pictures and history
 * go with it. To keep a record of a job called off, she cancels it instead.
 */
export async function deleteJob(_previous: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const typed = typedIn(formData);
  const id = idField(formData, 'id');
  if (!id) return missing('job', typed);

  const supabase = await createSupabase();
  // The pictures are removed with the job, so their files must be too. Read where they are first.
  const files = await supabase.from('attachment').select('storage_path').eq('order_id', id);
  if (files.error) return unexpected('the job', files.error, typed);

  const { error } = await supabase.rpc('delete_job', { p_order_id: id });
  if (error?.code === 'P0002') return missing('job', typed);
  if (error) return saveFailed('the job', error, typed);

  await removeFiles(
    supabase,
    files.data.map((f: { storage_path: string }) => f.storage_path),
  );
  revalidatePath('/', 'layout');
  redirect('/orders');
}

// ---------------------------------------------------------------------------------------------
// Garments

export async function addGarment(_previous: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const typed = typedIn(formData);
  const orderId = idField(formData, 'order-id');
  if (!orderId) return missing('order', typed);
  const parsed = parseGarment(formData);
  if (!parsed.ok) return failure(CHECK_FIELDS, parsed.errors, typed);

  const supabase = await createSupabase();
  const { error } = await supabase.rpc('add_garment', {
    p_order_id: orderId,
    p_garment_type: parsed.value.garmentType,
    p_brief: parsed.value.brief,
  });
  if (error?.code === 'P0002') return missing('order', typed);
  if (error) return saveFailed('the garment', error, typed);

  revalidatePath('/', 'layout');
  return success('Garment added.');
}

export async function saveGarment(_previous: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const typed = typedIn(formData);
  const id = idField(formData, 'id');
  if (!id) return missing('garment', typed);
  const parsed = parseGarment(formData);
  if (!parsed.ok) return failure(CHECK_FIELDS, parsed.errors, typed);

  const supabase = await createSupabase();
  const { data, error } = await supabase
    .from('order_item')
    .update({ garment_type: parsed.value.garmentType, brief: parsed.value.brief })
    .eq('id', id)
    .select('id');
  if (error) return saveFailed('the garment', error, typed);
  if (data.length !== 1) return missing('garment', typed);

  revalidatePath('/', 'layout');
  return success('Garment saved.');
}

export async function removeGarment(_previous: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const typed = typedIn(formData);
  const id = idField(formData, 'id');
  if (!id) return missing('garment', typed);

  const supabase = await createSupabase();
  const { data, error } = await supabase.from('order_item').delete().eq('id', id).select('id');
  if (error) return saveFailed('the garment', error, typed);
  if (data.length !== 1) return missing('garment', typed);

  revalidatePath('/', 'layout');
  return success('Garment removed.');
}

/** Makes a garment to another saved version of the client's measurements (the database checks they are the client's). */
export async function switchMeasurements(_previous: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const typed = typedIn(formData);
  const id = idField(formData, 'id');
  const setId = idField(formData, 'measurement-set-id');
  if (!id) return missing('garment', typed);
  if (!setId) return failure('Choose a version of the measurements.', {}, typed);

  const supabase = await createSupabase();
  const { data, error } = await supabase
    .from('order_item')
    .update({ measurement_set_id: setId })
    .eq('id', id)
    .select('id');
  if (violates(error, 'order_item_measurements_fk')) return missing('version of the measurements', typed);
  if (error) return saveFailed('the garment', error, typed);
  if (data.length !== 1) return missing('garment', typed);

  revalidatePath('/', 'layout');
  return success('Garment now uses these measurements.');
}

// ---------------------------------------------------------------------------------------------
// Sketches and photos

/**
 * Adds a picture. The file is checked by what is inside it, stored in her private folder, and then described
 * by a row. If the row is refused (a delivered order, too many pictures) the file is taken out again.
 */
export async function uploadAttachment(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const typed = typedIn(formData);
  const orderId = idField(formData, 'order-id');
  if (!orderId) return missing('order', typed);
  const details = parseAttachmentDetails(formData);
  if (!details.ok) return failure(CHECK_FIELDS, details.errors, typed);

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0)
    return failure(CHECK_FIELDS, { file: 'Choose a picture to add.' }, typed);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = checkUpload(bytes.byteLength, bytes.subarray(0, 16));
  if (!check.ok) return failure(CHECK_FIELDS, { file: check.message }, typed);

  const supabase = await createSupabase();
  const order = await loadOrder(supabase, orderId);
  if (!order) return missing('order', typed);
  if (isClosed(order.status))
    return failure('This order is delivered or cancelled. Reopen it before adding pictures.', {}, typed);

  const id = crypto.randomUUID();
  const path = storagePath(user.id, orderId, id, check.type);
  const stored = await supabase.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType: check.type, upsert: false });
  if (stored.error) return unexpected('the picture', stored.error, typed);

  const { error } = await supabase.from('attachment').insert({
    id,
    order_id: orderId,
    kind: details.value.kind,
    caption: details.value.caption,
    storage_path: path,
    content_type: check.type,
    size_bytes: bytes.byteLength,
  });
  if (error) {
    await removeFiles(supabase, [path]);
    return saveFailed('the picture', error, typed);
  }

  revalidatePath('/', 'layout');
  return success('Picture added.');
}

export async function saveAttachmentCaption(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireUser();
  const typed = typedIn(formData);
  const id = idField(formData, 'id');
  if (!id) return missing('picture', typed);
  // Only the caption can change; the kind is part of the picture's name (Sketch 2) and stays.
  const parsed = parseCaption(formData);
  if (!parsed.ok) return failure(CHECK_FIELDS, parsed.errors, typed);

  const supabase = await createSupabase();
  const { data, error } = await supabase
    .from('attachment')
    .update({ caption: parsed.value })
    .eq('id', id)
    .select('id');
  if (error) return saveFailed('the caption', error, typed);
  if (data.length !== 1) return missing('picture', typed);

  revalidatePath('/', 'layout');
  return success('Caption saved.');
}

export async function removeAttachment(_previous: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const typed = typedIn(formData);
  const id = idField(formData, 'id');
  if (!id) return missing('picture', typed);

  const supabase = await createSupabase();
  // The row goes first. If the file were removed first and the row then refused, the page would show a
  // picture that is gone. A file left behind by a failed second step is invisible and harmless.
  const { data, error } = await supabase.from('attachment').delete().eq('id', id).select('storage_path');
  if (error) return saveFailed('the picture', error, typed);
  if (data.length !== 1) return missing('picture', typed);

  await removeFiles(
    supabase,
    data.map((f: { storage_path: string }) => f.storage_path),
  );
  revalidatePath('/', 'layout');
  return success('Picture removed.');
}

/** Takes files out of storage. A failure is logged and does not stop the person's action: the files are already unlinked. */
async function removeFiles(
  supabase: Awaited<ReturnType<typeof createSupabase>>,
  paths: string[],
): Promise<void> {
  if (paths.length === 0) return;
  const { error } = await supabase.storage.from(BUCKET).remove(paths);
  if (error)
    console.error(`Could not remove ${paths.length} stored file(s) [${error.message}]: ${paths.join(', ')}`);
}
