import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { fail } from './rows';

/** One person of the workspace: its owner first, then the people she added (decision 0081). */
export interface Person {
  id: string;
  name: string;
  email: string;
  isOwner: boolean;
  isMe: boolean;
}

const personRow = z.object({
  user_id: z.string(),
  name: z.string(),
  email: z.string(),
  is_owner: z.boolean(),
  is_me: z.boolean(),
});

export async function loadPeople(supabase: SupabaseClient): Promise<Person[]> {
  const { data, error } = await supabase.rpc('workspace_people');
  if (error) fail('the people of the workspace', error);
  return z
    .array(personRow)
    .parse(data)
    .map((p) => ({ id: p.user_id, name: p.name, email: p.email, isOwner: p.is_owner, isMe: p.is_me }));
}

/** "Hanna", or her email when she has not given a name. */
export const personName = (p: Pick<Person, 'name' | 'email'>): string => p.name || p.email;
