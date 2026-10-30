import { z } from 'zod';
import { isIsoDate, isValidTimeZone } from '../dates';
import { issuesByField, text, type FieldErrors, type Result } from '../form-input';
import { workDayProblem } from './rules';
import { isTimeOfDay } from './time';
import type { WorkDay } from './types';

/**
 * Reads the seven rows of the working-week form. A row is a working day only when its
 * "works" box is ticked. Each row has: works-N, start-N, end-N, and an optional break
 * (break-start-N, break-end-N). The screen edits one break per day.
 */
export function parseWorkWeek(data: FormData): Result<WorkDay[]> {
  const days: WorkDay[] = [];
  const errors: FieldErrors = {};

  for (let weekday = 1; weekday <= 7; weekday++) {
    if (data.get(`works-${weekday}`) !== 'on') continue;
    const start = text(data, `start-${weekday}`);
    const end = text(data, `end-${weekday}`);
    const breakStart = text(data, `break-start-${weekday}`);
    const breakEnd = text(data, `break-end-${weekday}`);

    let breaks: WorkDay['breaks'] = [];
    if (breakStart || breakEnd) {
      if (!isTimeOfDay(breakStart) || !isTimeOfDay(breakEnd)) {
        errors[`break-${weekday}`] = 'Fill in both the start and the end of the break, or leave both empty.';
        continue;
      }
      breaks = [{ start: breakStart, end: breakEnd }];
    }

    const day: WorkDay = { weekday, start, end, breaks };
    const problem = workDayProblem(day);
    if (problem) {
      errors[`day-${weekday}`] = problem;
      continue;
    }
    days.push(day);
  }

  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, value: days };
}

const exceptionSchema = z.object({
  day: z.string().refine(isIsoDate, 'Choose a date.'),
  kind: z.enum(['closed', 'shortened']),
  hours: z.coerce.number().min(0).max(24).optional(),
  minutes: z.coerce.number().int().min(0).max(59).optional(),
  reason: z.string().trim().max(200, 'Keep the reason under 200 characters.'),
});

export interface ParsedException {
  day: string;
  minutesAvailable: number;
  reason: string;
}

/** Reads the "add a day off or shorter day" form. Closed days are 0 minutes. */
export function parseException(data: FormData): Result<ParsedException> {
  const parsed = exceptionSchema.safeParse({
    day: text(data, 'day'),
    kind: text(data, 'kind'),
    hours: text(data, 'hours') || undefined,
    minutes: text(data, 'minutes') || undefined,
    reason: text(data, 'reason'),
  });

  if (!parsed.success) {
    const errors = issuesByField(parsed.error);
    if (errors.kind) errors.kind = 'Choose whether she is closed or working a shorter day.';
    if (errors.hours) errors.hours = 'Enter hours between 0 and 24.';
    if (errors.minutes) errors.minutes = 'Enter minutes between 0 and 59.';
    return { ok: false, errors };
  }

  const { day, kind, hours = 0, minutes = 0, reason } = parsed.data;
  if (kind === 'closed') return { ok: true, value: { day, minutesAvailable: 0, reason } };

  const total = Math.round(hours) * 60 + minutes;
  if (total <= 0 || total > 1440) {
    return { ok: false, errors: { hours: 'A shorter day needs some time. For a day off, choose closed.' } };
  }
  return { ok: true, value: { day, minutesAvailable: total, reason } };
}

export interface ParsedProfile {
  name: string;
  timezone: string;
}

/** Reads her name and time zone from the settings form. */
export function parseProfile(data: FormData): Result<ParsedProfile> {
  const errors: FieldErrors = {};
  const name = text(data, 'name');
  if (name.length > 120) errors.name = 'Keep the name under 120 characters.';

  const timezone = text(data, 'timezone');
  if (!isValidTimeZone(timezone)) errors.timezone = 'Choose a time zone from the list.';

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { name, timezone } };
}
