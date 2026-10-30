import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { addDays, type IsoDate } from '@/domain/dates';
import { isOrderStatus, type OrderStatus } from '@/domain/orders/status';
import type { Step } from '@/domain/steps/agenda';
import { fail, isoDay } from './rows';

/** Steps, their jobs and her templates, read as the signed-in designer (docs/calendar-first.md). */

/** 'HH:MM:SS' from the database to 'HH:MM'. */
const time = z
  .string()
  .regex(/^\d{2}:\d{2}(:\d{2})?$/)
  .transform((t) => t.slice(0, 5));

const STEP_COLUMNS = `id, title, sort, order_item_id, on_day, until_day, starts_at, ends_at, done_on,
  job:orders(id, number, title, status, delivery_on, client:client(name))`;

const stepRow = z.object({
  id: z.string(),
  title: z.string(),
  sort: z.number().int(),
  order_item_id: z.string().nullable(),
  on_day: isoDay.nullable(),
  until_day: isoDay.nullable(),
  starts_at: time.nullable(),
  ends_at: time.nullable(),
  done_on: isoDay.nullable(),
  job: z
    .object({
      id: z.string(),
      number: z.number().int(),
      title: z.string(),
      status: z.string().refine(isOrderStatus),
      delivery_on: isoDay,
      client: z.object({ name: z.string() }).nullable(),
    })
    .nullable(),
});

export interface JobStep extends Step {
  sort: number;
  garmentId: string | null;
}

function toStep(r: z.infer<typeof stepRow>): JobStep {
  return {
    id: r.id,
    title: r.title,
    sort: r.sort,
    garmentId: r.order_item_id,
    onDay: r.on_day,
    untilDay: r.until_day,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    doneOn: r.done_on,
    job: r.job && {
      id: r.job.id,
      number: r.job.number,
      title: r.job.title,
      status: r.job.status as OrderStatus,
      dueOn: r.job.delivery_on,
      clientName: r.job.client?.name ?? null,
    },
  };
}

/**
 * Every step her calendar may show around `today`: those not done (wherever they are), and those done from a week
 * back on. Which of them show, and where, is the agenda's to decide.
 */
export async function loadCalendarSteps(supabase: SupabaseClient, today: IsoDate): Promise<JobStep[]> {
  const { data, error } = await supabase
    .from('task')
    .select(STEP_COLUMNS)
    .or(`done_on.is.null,on_day.gte.${addDays(today, -7)}`)
    .order('on_day', { nullsFirst: false })
    .order('sort')
    .limit(3000);
  if (error) fail('her steps', error);
  return z.array(stepRow).parse(data).map(toStep);
}

/** The open steps between two days, for the month. */
export async function loadStepsBetween(
  supabase: SupabaseClient,
  first: IsoDate,
  last: IsoDate,
): Promise<JobStep[]> {
  const { data, error } = await supabase
    .from('task')
    .select(STEP_COLUMNS)
    .lte('on_day', last)
    .or(`until_day.gte.${first},on_day.gte.${first}`)
    .limit(3000);
  if (error) fail('her steps', error);
  return z.array(stepRow).parse(data).map(toStep);
}

/** One job's steps, in their order. */
export async function loadJobSteps(supabase: SupabaseClient, orderId: string): Promise<JobStep[]> {
  const { data, error } = await supabase
    .from('task')
    .select(STEP_COLUMNS)
    .eq('order_id', orderId)
    .order('sort')
    .order('created_at')
    .limit(500);
  if (error) fail('the job’s steps', error);
  return z.array(stepRow).parse(data).map(toStep);
}

/** The titles of the steps she has used, with how often: her usual steps, offered as buttons. */
export async function loadUsedStepTitles(
  supabase: SupabaseClient,
): Promise<{ title: string; times: number }[]> {
  const { data, error } = await supabase.from('task').select('title').limit(5000);
  if (error) fail('her steps', error);
  const counts = new Map<string, { title: string; times: number }>();
  for (const { title } of z.array(z.object({ title: z.string() })).parse(data)) {
    const key = title.trim().toLowerCase();
    const seen = counts.get(key);
    if (seen) seen.times += 1;
    else counts.set(key, { title: title.trim(), times: 1 });
  }
  return [...counts.values()];
}

// ---------------------------------------------------------------------------------------------
// Done or not

export type DoneResult =
  | { result: 'applied' }
  | { result: 'stale'; message: string }
  | { result: 'missing'; message: string }
  | { result: 'failed'; error: { code?: string; message: string } };

export const STEP_MISSING = 'That step is no longer there. It may have been removed.';

/**
 * Ticks a step done (today) or opens it again: the one way, for the buttons and for taps that waited for the signal.
 * Only if it is still as she saw it, and the write itself is conditional on that, so a change made on another
 * device in between is never undone.
 */
export async function setDone(
  supabase: SupabaseClient,
  input: { stepId: string; sawDone: boolean; done: boolean; today: IsoDate },
): Promise<DoneResult> {
  let query = supabase
    .from('task')
    .update({ done_on: input.done ? input.today : null })
    .eq('id', input.stepId);
  query = input.sawDone ? query.not('done_on', 'is', null) : query.is('done_on', null);
  const { data, error } = await query.select('id');
  if (error) return { result: 'failed', error };
  if (data.length === 1) return { result: 'applied' };
  const now = await supabase.from('task').select('done_on').eq('id', input.stepId).maybeSingle();
  if (now.error) return { result: 'failed', error: now.error };
  if (!now.data) return { result: 'missing', message: STEP_MISSING };
  return {
    result: 'stale',
    message: (now.data as { done_on: string | null }).done_on
      ? 'It was already ticked done on another device.'
      : 'It was opened again on another device.',
  };
}
