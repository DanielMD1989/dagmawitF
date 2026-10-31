'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { failure, success, typedIn, type ActionState } from '@/lib/action-state';
import { parseException, parseProfile, parseWorkWeek } from '@/domain/calendar/forms';
import { strayFiles } from '@/domain/files';
import { parseMeasurementDefaults } from '@/domain/preferences';
import { parsePasswordChange } from '@/domain/passwords';
import { addPersonRefusal, parsePersonEmail } from '@/domain/people/forms';
import { unexpected } from '@/server/action-errors';
import { requireUser, getWorkspaceId } from '@/server/session';
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
    })
    .eq('owner_id', user.id)
    .select('owner_id');
  if (error) return unexpected('your details', error, typed);
  if (data.length !== 1)
    return unexpected(
      'your details',
      { message: `expected to update 1 profile, updated ${data.length}` },
      typed,
    );

  revalidatePath('/', 'layout');
  return success('Details saved.');
}

export async function saveMeasurementDefaults(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const typed = typedIn(formData);
  const parsed = parseMeasurementDefaults(formData);
  if (!parsed.ok) return failure('Check the fields marked below.', parsed.errors, typed);

  const supabase = await createSupabase();
  const { data, error } = await supabase
    .from('profile')
    .update({ measurement_unit: parsed.value.measurementUnit })
    .eq('owner_id', user.id)
    .select('owner_id');
  if (error) return unexpected('the unit', error, typed);
  if (data.length !== 1)
    return unexpected('the unit', { message: `expected to update 1 profile, updated ${data.length}` }, typed);

  revalidatePath('/', 'layout');
  return success('Saved.');
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
  await requireUser();
  const supabase = await createSupabase();
  const recorded = await supabase.from('attachment').select('storage_path');
  if (recorded.error) return unexpected('the tidy-up', recorded.error, {});
  const known = new Set(recorded.data.map((r: { storage_path: string }) => r.storage_path));

  const bucket = supabase.storage.from('order-files');
  const orders = await listAll(bucket, await getWorkspaceId());
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

/**
 * Changes her password (decision 0065). The password she uses now is checked first, so a phone left unlocked is not
 * enough to take the account. Nothing she typed is sent back to the page.
 */
export async function changePassword(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = parsePasswordChange(formData);
  if (!parsed.ok) return failure('Check the fields marked below.', parsed.errors);
  if (!user.email) return failure('This account has no email address, so its password cannot be checked.');

  const supabase = await createSupabase();
  const check = await supabase.auth.signInWithPassword({ email: user.email, password: parsed.value.current });
  if (check.error) {
    if (check.error.status === 429) return failure('Too many tries. Wait a few minutes, then try again.');
    return failure('Check the fields marked below.', {
      'current-password': 'That is not the password you use now.',
    });
  }
  const { error } = await supabase.auth.updateUser({ password: parsed.value.next });
  if (error) {
    if (error.code === 'weak_password') {
      return failure('Check the fields marked below.', { 'new-password': 'Choose a stronger password.' });
    }
    return unexpected('the new password', error, {});
  }
  return success('Password changed. Use the new one next time you sign in.');
}

export async function signOut(): Promise<void> {
  const supabase = await createSupabase();
  await supabase.auth.signOut();
  redirect('/sign-in');
}

/** She adds the account of someone who works with her (decision 0081): it then sees and changes everything she does. */
export async function addPerson(_previous: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const typed = typedIn(formData);
  const parsed = parsePersonEmail(formData);
  if (!parsed.ok) return failure('Check the email.', parsed.errors, typed);
  const supabase = await createSupabase();
  const { error } = await supabase.rpc('add_member', { p_email: parsed.value });
  if (error) {
    const said = addPersonRefusal(error.code, error.message);
    return failure(said, { email: said }, typed);
  }
  revalidatePath('/', 'layout');
  return success('Added. They now see and work on everything here.');
}

/** She removes a person from her workspace; or a person leaves it. */
export async function removePerson(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const me = await requireUser();
  const id = idSchema.safeParse(formData.get('id'));
  if (!id.success) return failure('That person could not be found. Reload the page.');
  const supabase = await createSupabase();
  const { error } = await supabase.rpc('remove_member', { p_user: id.data });
  if (error) return unexpected('the person', error, {});
  revalidatePath('/', 'layout');
  if (id.data === me.id) redirect('/');
  return success('Removed. They no longer see anything here.');
}
