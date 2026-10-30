import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { addDays, todayIn, type IsoDate } from '@/domain/dates';
import { fromDatabaseTime } from '@/domain/calendar/time';
import type { CalendarException, Profile, WorkDay } from '@/domain/calendar/types';
import { fail, isoDay } from './rows';

// What the database sends back, checked at the boundary so the rest of the app can trust it.
const profileRow = z.object({
  name: z.string(),
  timezone: z.string(),
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
  // All three at once (decision 0077). Her days off are asked for from the earliest date that can be "today"
  // anywhere, since her time zone is not known yet, and trimmed to her today once it is.
  const earliest = addDays(todayIn('UTC'), -1);
  const [profileResult, weekResult, exceptionResult] = await Promise.all([
    supabase.from('profile').select('name, timezone').single(),
    supabase.from('work_week').select('weekday, start_time, end_time, breaks').order('weekday'),
    supabase
      .from('calendar_exception')
      .select('id, day, minutes_available, reason')
      .gte('day', earliest)
      .order('day')
      .limit(500),
  ]);
  if (profileResult.error) fail('her profile', profileResult.error);
  if (weekResult.error) fail('her working week', weekResult.error);
  if (exceptionResult.error) fail('her days off', exceptionResult.error);
  const p = profileRow.parse(profileResult.data);
  const today = todayIn(p.timezone);

  return {
    profile: {
      name: p.name,
      timezone: p.timezone,
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
      .filter((r) => r.day >= today)
      .map((r) => ({
        id: r.id,
        day: r.day,
        minutesAvailable: r.minutes_available,
        reason: r.reason,
      })),
    today,
  };
}
