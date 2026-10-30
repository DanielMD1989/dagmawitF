import { z } from 'zod';
import { loadPreferences } from '@/server/preferences';
import { getSessionUser } from '@/server/session';
import { setDone } from '@/server/steps';
import { createSupabase } from '@/server/supabase';

/**
 * A tick that waited on the phone for the signal (docs/harden.md, "The taps that wait"). The shape is checked here;
 * the rule is `setDone`'s, the same as the button's: only if the step is still as she saw it.
 */

const tick = z.object({ stepId: z.uuid(), sawDone: z.boolean(), done: z.boolean() });

const answer = (status: number, body: Record<string, unknown>) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

const UNREADABLE = 'A tick could not be read, so it was left.';

export async function POST(request: Request): Promise<Response> {
  // Only the app's own pages may send ticks.
  const origin = request.headers.get('origin');
  if (origin && new URL(origin).host !== request.headers.get('host')) {
    return answer(403, { result: 'refused' });
  }
  if (!(await getSessionUser())) return answer(401, { result: 'signed-out' });

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return answer(400, { result: 'invalid', message: UNREADABLE });
  }
  const parsed = tick.safeParse(json);
  if (!parsed.success || parsed.data.sawDone === parsed.data.done) {
    return answer(400, { result: 'invalid', message: UNREADABLE });
  }

  const supabase = await createSupabase();
  const { today } = await loadPreferences(supabase);
  const r = await setDone(supabase, { ...parsed.data, today });
  if (r.result === 'failed') {
    console.error(
      `A waiting tick on step ${parsed.data.stepId} failed [${r.error.code ?? 'no code'}]: ${r.error.message}`,
    );
    return answer(500, { result: 'failed' });
  }
  return answer(200, r);
}
