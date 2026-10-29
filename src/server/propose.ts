import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { failure, type ActionState } from '@/lib/action-state';
import { ruleMessage } from '@/lib/database-errors';
import { plan } from '@/domain/engine';
import { buildPlanInput } from '@/domain/planning/input';
import { toStored } from '@/domain/planning/proposal';
import { loadPlanningFacts } from './planning';

/**
 * The one place a proposal is made (docs/planning.md, "Proposing a plan"; docs/change.md): plans the whole atelier
 * from today's facts and stores the result. Says why when the engine refuses or the facts moved meanwhile.
 */
export async function proposeNow(
  supabase: SupabaseClient,
): Promise<{ ok: true; number: number } | { ok: false; message: string }> {
  const { epoch, progress, facts } = await loadPlanningFacts(supabase);
  const input = buildPlanInput(facts);
  const result = plan(input);
  if (!result.ok) {
    // The engine stops rather than guess (docs/engine.md); each reason names what to change.
    return {
      ok: false,
      message: `The plan could not be made. ${result.errors.map((e) => e.message).join(' ')}`,
    };
  }
  const garments = new Map(facts.tasks.map((t) => [t.id, t.garment]));
  const stored = toStored(input, result.plan, (id) => garments.get(id) ?? null);
  const { data, error } = await supabase.rpc('save_proposal', {
    p_epoch: epoch,
    p_progress: progress,
    p_made_for: facts.today,
    p_result: stored.result,
    p_slots: stored.slots,
  });
  if (error) {
    const rule = ruleMessage(error);
    if (rule) return { ok: false, message: rule };
    console.error(`Saving a proposal failed [${error.code ?? 'no code'}]: ${error.message}`);
    return { ok: false, message: 'Could not save the proposal. Nothing was changed. Try again in a moment.' };
  }
  return { ok: true, number: Number(data) };
}

/** Where a proposal is read, from an order or from the whole atelier. */
export const reviewPath = (number: number, orderId: string | null) =>
  `/plan/${number}${orderId ? `?order=${orderId}` : ''}`;

/**
 * "Save and see impact" (docs/change.md): after a change is saved, make a proposal and open it for this order.
 * The change stays saved whatever happens here; if no proposal can be made she is told why, next to the form.
 */
export async function seeImpact(supabase: SupabaseClient, orderId: string | null): Promise<ActionState> {
  const made = await proposeNow(supabase);
  if (!made.ok) return failure(`Saved. ${made.message}`, {}, null);
  revalidatePath('/', 'layout');
  redirect(reviewPath(made.number, orderId));
}

/** Whether a form asked to see the impact of its change. */
export const wantsImpact = (formData: FormData) => formData.get('intent') === 'impact';
