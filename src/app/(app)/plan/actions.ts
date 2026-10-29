'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { failure, typedIn, type ActionState } from '@/lib/action-state';
import { idField, parseWholeNumber, text } from '@/domain/form-input';
import { missing, saveFailed } from '@/server/action-errors';
import { proposeNow, reviewPath } from '@/server/propose';
import { requireUser } from '@/server/session';
import { createSupabase } from '@/server/supabase';

// Every action does the same four things, in this order:
//   1. check who is asking  2. validate the input  3. write as her (row-level security applies)
//   4. refresh what the screens show

/**
 * Plans the whole atelier from today's facts and stores the result as a proposal (docs/planning.md, "Proposing a
 * plan"). Nothing she sees changes until she approves it.
 */
export async function makeProposal(_previous: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const typed = typedIn(formData);
  const orderId = idField(formData, 'order-id');

  const made = await proposeNow(await createSupabase());
  if (!made.ok) return failure(made.message, {}, typed);

  revalidatePath('/', 'layout');
  redirect(reviewPath(made.number, orderId));
}

function readNumber(formData: FormData): number | null {
  const n = parseWholeNumber(text(formData, 'number'));
  return n !== null && n > 0 ? n : null;
}

export async function approvePlan(_previous: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const typed = typedIn(formData);
  const number = readNumber(formData);
  if (number === null) return missing('plan', typed);
  const orderId = idField(formData, 'order-id');

  const supabase = await createSupabase();
  const { error } = await supabase.rpc('approve_plan', { p_number: number });
  if (error?.code === 'P0002') return missing('plan', typed);
  if (error) return saveFailed('the approval', error, typed);

  revalidatePath('/', 'layout');
  redirect(orderId ? `/orders/${orderId}/plan` : reviewPath(number, null));
}

export async function rejectPlan(_previous: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const typed = typedIn(formData);
  const number = readNumber(formData);
  if (number === null) return missing('plan', typed);
  const orderId = idField(formData, 'order-id');

  const supabase = await createSupabase();
  const { error } = await supabase.rpc('reject_plan', { p_number: number });
  if (error) return saveFailed('the proposal', error, typed);

  revalidatePath('/', 'layout');
  redirect(orderId ? `/orders/${orderId}/plan` : '/plan');
}
