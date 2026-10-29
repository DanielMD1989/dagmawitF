import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { todayIn, type IsoDate } from '@/domain/dates';
import { fromDatabaseTime } from '@/domain/calendar/time';
import type { CalendarException, Profile, WorkDay } from '@/domain/calendar/types';
import { fail, isoDay } from './rows';

// What the database sends back, checked at the boundary so the rest of the app can trust it.
const profileRow = z.object({
  name: z.string(),
  timezone: z.string(),
  planning_ratio: z.coerce.number(),
});

const workWeekRow = z.object({
  weekday: z.number().int().min(1).max(7),
  start_time: z.string(),
  end_time: z.string(),
  breaks: z.array(z.object({ start: z.string(), end: z.string() })),
});

const exceptionRow = z.object({
  id: z.string(),
  day: isoDay,
  minutes_available: z.number().int(),
  reason: z.string(),
});

export interface CalendarSettings {
  profile: Profile;
  week: WorkDay[];
  /** Today and later, soonest first. Past dates stay in the database and out of the way. */
  exceptions: (CalendarException & { id: string })[];
  today: IsoDate;
}

/** Everything the calendar screens need, read as the signed-in designer. */
export async function loadCalendarSettings(supabase: SupabaseClient): Promise<CalendarSettings> {
  const profileResult = await supabase.from('profile').select('name, timezone, planning_ratio').single();
  if (profileResult.error) fail('her profile', profileResult.error);
  const p = profileRow.parse(profileResult.data);

  const today = todayIn(p.timezone);

  const [weekResult, exceptionResult] = await Promise.all([
    supabase.from('work_week').select('weekday, start_time, end_time, breaks').order('weekday'),
    supabase
      .from('calendar_exception')
      .select('id, day, minutes_available, reason')
      .gte('day', today)
      .order('day')
      .limit(500),
  ]);
  if (weekResult.error) fail('her working week', weekResult.error);
  if (exceptionResult.error) fail('her days off', exceptionResult.error);

  return {
    profile: {
      name: p.name,
      timezone: p.timezone,
      planningRatio: p.planning_ratio,
    },
    week: z
      .array(workWeekRow)
      .parse(weekResult.data)
      .map((r) => ({
        weekday: r.weekday,
        start: fromDatabaseTime(r.start_time),
        end: fromDatabaseTime(r.end_time),
        breaks: r.breaks,
      })),
    exceptions: z
      .array(exceptionRow)
      .parse(exceptionResult.data)
      .map((r) => ({
        id: r.id,
        day: r.day,
        minutesAvailable: r.minutes_available,
        reason: r.reason,
      })),
    today,
  };
}
