import { z } from 'zod';
import { isIsoDate } from '@/domain/dates';
import { TASK_STATUSES } from '@/domain/day/progress';
import { loadPreferences } from '@/server/preferences';
import { recordProgress } from '@/server/progress';
import { getSessionUser } from '@/server/session';
import { createSupabase } from '@/server/supabase';

/**
 * A tap that waited on the phone for the signal (docs/harden.md, "The taps that wait"). The shape is checked here;
 * the rules are `recordProgress`'s, the same as the forms' (decision 0058).
 */

const tap = z.object({
  taskId: z.uuid(),
  seen: z.enum(TASK_STATUSES),
  change: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('start') }),
    z.object({
      kind: z.literal('done'),
      doneOn: z.string().refine(isIsoDate),
      actualMinutes: z.number().nullable(),
    }),
    z.object({ kind: z.literal('remaining'), minutes: z.number() }),
  ]),
});

const answer = (status: number, body: Record<string, unknown>) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(request: Request): Promise<Response> {
  // Only the app's own pages may send taps.
  const origin = request.headers.get('origin');
  if (origin && new URL(origin).host !== request.headers.get('host')) {
    return answer(403, { result: 'refused' });
  }
  if (!(await getSessionUser())) return answer(401, { result: 'signed-out' });

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return answer(400, { result: 'invalid', message: 'A tap could not be read, so it was left.' });
  }
  const parsed = tap.safeParse(json);
  if (!parsed.success) {
    return answer(400, { result: 'invalid', message: 'A tap could not be read, so it was left.' });
  }

  const supabase = await createSupabase();
  const { today } = await loadPreferences(supabase);
  const { taskId, seen, change } = parsed.data;
  const r = await recordProgress(supabase, { taskId, seen, change, today });
  if (r.result === 'failed') {
    console.error(
      `A waiting tap on task ${taskId} failed [${r.error.code ?? 'no code'}]: ${r.error.message}`,
    );
    return answer(500, { result: 'failed' });
  }
  return answer(200, r);
}
