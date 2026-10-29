'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { failure, typedIn, type ActionState } from '@/lib/action-state';
import { violates } from '@/lib/database-errors';
import { parseNewOrder } from '@/domain/orders/forms';
import { saveFailed } from '@/server/action-errors';
import { loadPreferences } from '@/server/preferences';
import { requireUser } from '@/server/session';
import { createSupabase } from '@/server/supabase';

// Every action does the same four things, in this order:
//   1. check who is asking  2. validate the input  3. write as her (row-level security applies)
//   4. refresh what the screens show

/**
 * Makes an order with its first garment, and a new client if she typed one, in one step. She is taken to the
 * order's preparation list, because what it is waiting for is the next thing to write down.
 */
export async function createOrder(_previous: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const typed = typedIn(formData);
  const supabase = await createSupabase();
  const prefs = await loadPreferences(supabase);
  const parsed = parseNewOrder(formData, { today: prefs.today, defaultBufferDays: prefs.defaultBufferDays });
  if (!parsed.ok)
    return failure(parsed.errors.form ?? 'Check the fields marked below.', parsed.errors, typed);
  const order = parsed.value;

  const create = () =>
    supabase.rpc('create_order', {
      p_client_id: order.client.kind === 'existing' ? order.client.id : null,
      p_client_name: order.client.kind === 'new' ? order.client.name : null,
      p_client_phone: order.client.kind === 'new' ? order.client.phone : null,
      p_number: order.number,
      p_delivery_on: order.deliveryOn,
      p_buffer_days: order.bufferDays,
      p_notes: order.notes,
      p_garment_type: order.garmentType,
      p_brief: order.brief,
      p_confirm: order.confirm,
    });

  let result = await create();
  // Two orders made in the same moment can be given the same next number. The second one is refused whole
  // (nothing was saved), so asking again takes the number after. A number she typed is never changed.
  if (violates(result.error, 'orders_number_key') && order.number === null) result = await create();

  if (result.error) {
    if (violates(result.error, 'orders_number_key'))
      return failure(
        'Check the fields marked below.',
        { number: 'Another order already has this number.' },
        typed,
      );
    if (violates(result.error, 'orders_client_fk'))
      return failure(
        'Check the fields marked below.',
        { client: 'That client could not be found. Choose another.' },
        typed,
      );
    return saveFailed('the order', result.error, typed);
  }

  const id = z.string().parse(result.data);
  revalidatePath('/', 'layout');
  redirect(`/orders/${id}/preparation`);
}
