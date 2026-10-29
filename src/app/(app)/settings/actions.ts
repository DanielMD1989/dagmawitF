'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { failure, success, typedIn, type ActionState } from '@/lib/action-state';
import { parseException, parseProfile, parseWorkWeek } from '@/domain/calendar/forms';
import { strayFiles } from '@/domain/files';
import { parseOrderDefaults } from '@/domain/preferences';
import { unexpected } from '@/server/action-errors';
import { requireUser } from '@/server/session';
import { createSupabase } from '@/server/supabase';

// Every action does the same four things, in this order:
//   1. check who is asking  2. validate the input  3. write as her (row-level security applies)
//   4. refresh what the screens show

export async function saveWorkWeek(_previous: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const typed = typedIn(formData);
  const parsed = parseWorkWeek(formData);
  if (!parsed.ok) return failure('Some days need fixing. They are marked below.', parsed.errors, typed);

  const supabase = await createSupabase();
  const { error } = await supabase.rpc('replace_work_week', {
    p_days: parsed.value.map(({ weekday, start, end, breaks }) => ({ weekday, start, end, breaks })),
  });
  if (error) return unexpected('the working week', error, typed);

  revalidatePath('/', 'layout');
  return success('Working week saved.');
}

export async function saveProfile(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const typed = typedIn(formData);
  const parsed = parseProfile(formData);
  if (!parsed.ok) return failure('Check the fields marked below.', parsed.errors, typed);

  const supabase = await createSupabase();
  const { data, error } = await supabase
    .from('profile')
    .update({
      name: parsed.value.name,
      timezone: parsed.value.timezone,
      planning_ratio: parsed.value.planningRatio,
    })
    .eq('owner_id', user.id)
    .select('owner_id');
  if (error) return unexpected('her details', error, typed);
  if (data.length !== 1)
    return unexpected(
      'her details',
      { message: `expected to update 1 profile, updated ${data.length}` },
      typed,
    );

  revalidatePath('/', 'layout');
  return success('Details saved.');
}

export async function saveOrderDefaults(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const typed = typedIn(formData);
  const parsed = parseOrderDefaults(formData);
  if (!parsed.ok) return failure('Check the fields marked below.', parsed.errors, typed);

  const supabase = await createSupabase();
  const { data, error } = await supabase
    .from('profile')
    .update({
      default_buffer_days: parsed.value.defaultBufferDays,
      measurement_unit: parsed.value.measurementUnit,
    })
    .eq('owner_id', user.id)
    .select('owner_id');
  if (error) return unexpected('her defaults', error, typed);
  if (data.length !== 1)
    return unexpected(
      'her defaults',
      { message: `expected to update 1 profile, updated ${data.length}` },
      typed,
    );

  revalidatePath('/', 'layout');
  return success('Defaults saved.');
}

export async function addException(_previous: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const typed = typedIn(formData);
  const parsed = parseException(formData);
  if (!parsed.ok) return failure('Check the fields marked below.', parsed.errors, typed);

  const supabase = await createSupabase();
  const { error } = await supabase.from('calendar_exception').insert({
    day: parsed.value.day,
    minutes_available: parsed.value.minutesAvailable,
    reason: parsed.value.reason,
  });
  if (error?.code === '23505') {
    return failure(
      'That date already has an entry.',
      { day: 'Remove the existing entry for this date first.' },
      typed,
    );
  }
  if (error) return unexpected('the day', error, typed);

  revalidatePath('/', 'layout');
  return success('Saved.');
}

const idSchema = z.uuid();

export async function removeException(formData: FormData): Promise<void> {
  await requireUser();
  const id = idSchema.safeParse(formData.get('id'));
  if (!id.success) return;

  const supabase = await createSupabase();
  const { error } = await supabase.from('calendar_exception').delete().eq('id', id.data);
  if (error) console.error(`Removing a day failed [${error.code ?? 'no code'}]: ${error.message}`);

  revalidatePath('/', 'layout');
}

type Bucket = ReturnType<Awaited<ReturnType<typeof createSupabase>>['storage']['from']>;
type Listed = { path: string; createdAt: string | null; folder: boolean };

/** One level of her storage, every page of it. */
async function listAll(bucket: Bucket, prefix: string): Promise<Listed[] | null> {
  const found: Listed[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await bucket.list(prefix, {
      limit: 1000,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    });
    if (error) {
      console.error(`Listing stored pictures under ${prefix} failed: ${error.message}`);
      return null;
    }
    for (const f of data) {
      found.push({ path: `${prefix}/${f.name}`, createdAt: f.created_at ?? null, folder: f.id === null });
    }
    if (data.length < 1000) return found;
  }
}

/**
 * Removes stored pictures no record points to (docs/harden.md, "Tidy stored pictures"). Her pictures are stored as
 * <her id>/<order id>/<picture>, so her folder holds one folder per order.
 */
export async function tidyPictures(): Promise<ActionState> {
  const user = await requireUser();
  const supabase = await createSupabase();
  const recorded = await supabase.from('attachment').select('storage_path');
  if (recorded.error) return unexpected('the tidy-up', recorded.error, {});
  const known = new Set(recorded.data.map((r: { storage_path: string }) => r.storage_path));

  const bucket = supabase.storage.from('order-files');
  const orders = await listAll(bucket, user.id);
  if (!orders)
    return failure('The stored pictures could not be listed. Nothing was removed. Try again later.');
  const stored: Listed[] = [];
  for (const folder of orders.filter((o) => o.folder)) {
    const files = await listAll(bucket, folder.path);
    if (!files)
      return failure('The stored pictures could not be listed. Nothing was removed. Try again later.');
    stored.push(...files.filter((f) => !f.folder));
  }

  const stray = strayFiles(stored, known, new Date());
  if (stray.length === 0) return success('Nothing to tidy: every stored picture belongs to a record.');
  const { error } = await bucket.remove(stray);
  if (error) {
    console.error(`Removing stray pictures failed: ${error.message}`);
    return failure('The stray pictures could not be removed. Try again later.');
  }
  return success(
    `Removed ${stray.length} stored picture${stray.length === 1 ? '' : 's'} that no record pointed to.`,
  );
}

export async function signOut(): Promise<void> {
  const supabase = await createSupabase();
  await supabase.auth.signOut();
  redirect('/sign-in');
}
