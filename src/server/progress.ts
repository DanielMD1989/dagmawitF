import 'server-only';
import type { IsoDate } from '@/domain/dates';
import {
  allowedFrom,
  isTaskStatus,
  MISSING_MESSAGE,
  progressProblem,
  staleMessage,
  type ProgressChange,
} from '@/domain/day/progress';
import type { TaskStatus } from '@/domain/day/today';
import { isTaskKind } from '@/domain/planning/words';
import type { createSupabase } from './supabase';

type Supabase = Awaited<ReturnType<typeof createSupabase>>;

export type ProgressResult =
  | { result: 'applied' }
  | { result: 'stale'; message: string }
  | { result: 'missing'; message: string }
  | { result: 'invalid'; message: string }
  | { result: 'failed'; error: { code?: string; message: string } };

function columns(change: ProgressChange): Record<string, string | number | null> {
  switch (change.kind) {
    case 'start':
    case 'reopen':
      return { status: 'in_progress' };
    case 'done':
      return { status: 'done', done_on: change.doneOn, actual_minutes: change.actualMinutes };
    case 'remaining':
      return { status: 'in_progress', remaining_minutes: change.minutes };
  }
}

/**
 * Records progress on a task: the one way, for the forms and for taps that waited for the signal (decision 0058).
 * The change is applied only if the task still has the status she saw (decision 0056), and the write itself is
 * conditional on that status, so a change made in between on another device is never undone.
 */
export async function recordProgress(
  supabase: Supabase,
  input: { taskId: string; seen: TaskStatus; change: ProgressChange; today: IsoDate },
): Promise<ProgressResult> {
  const found = await supabase.from('task').select('kind, status').eq('id', input.taskId).maybeSingle();
  if (found.error) return { result: 'failed', error: found.error };
  if (!found.data) return { result: 'missing', message: MISSING_MESSAGE };
  const { kind, status } = found.data as { kind: unknown; status: unknown };
  if (!isTaskKind(kind) || !isTaskStatus(status))
    return { result: 'failed', error: { message: `task ${input.taskId} has an unknown kind or status` } };

  if (status !== input.seen || !allowedFrom(input.change).includes(status))
    return { result: 'stale', message: staleMessage(status) };
  const problem = progressProblem(input.change, kind, input.today);
  if (problem) return { result: 'invalid', message: problem };

  const { data, error } = await supabase
    .from('task')
    .update(columns(input.change))
    .eq('id', input.taskId)
    .eq('status', status)
    .select('id');
  if (error) return { result: 'failed', error };
  if (data.length !== 1) {
    // It moved between the read and the write.
    const now = await supabase.from('task').select('status').eq('id', input.taskId).maybeSingle();
    if (!now.data) return { result: 'missing', message: MISSING_MESSAGE };
    const moved = (now.data as { status: unknown }).status;
    return isTaskStatus(moved)
      ? { result: 'stale', message: staleMessage(moved) }
      : { result: 'failed', error: { message: `task ${input.taskId} has an unknown status` } };
  }
  return { result: 'applied' };
}
