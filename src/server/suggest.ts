import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { openDayRule } from '@/domain/calendar/open';
import type { IsoDate } from '@/domain/dates';
import { suggestDays, type Suggestion } from '@/domain/steps/suggest';
import { loadCalendarSettings } from './calendar';
import { loadTemplate } from './steps';

/**
 * The days a template's steps would get for a job due on `due`, counting back from it over the days she works
 * (decision 0066). Null when the template is not hers.
 */
export async function suggestFromTemplate(
  supabase: SupabaseClient,
  templateId: string,
  due: IsoDate,
): Promise<(Suggestion & { templateName: string }) | null> {
  const [template, calendar] = await Promise.all([
    loadTemplate(supabase, templateId),
    loadCalendarSettings(supabase),
  ]);
  if (!template) return null;
  const isOpen = openDayRule(
    calendar.week.map((d) => d.weekday),
    calendar.exceptions,
  );
  return { ...suggestDays(template.steps, due, calendar.today, isOpen), templateName: template.name };
}
