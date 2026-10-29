import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { todayIn, type IsoDate } from '@/domain/dates';
import { isMeasurementUnit, type MeasurementUnit } from '@/domain/measurements/sets';
import { fail } from './rows';

const row = z.object({
  name: z.string(),
  timezone: z.string(),
  default_buffer_days: z.number().int(),
  measurement_unit: z.string().refine(isMeasurementUnit),
});

/** What the order and measurement screens need to know about her. */
export interface Preferences {
  name: string;
  timezone: string;
  /** Today on her wall clock, not the server's. */
  today: IsoDate;
  defaultBufferDays: number;
  measurementUnit: MeasurementUnit;
}

export async function loadPreferences(supabase: SupabaseClient): Promise<Preferences> {
  const { data, error } = await supabase
    .from('profile')
    .select('name, timezone, default_buffer_days, measurement_unit')
    .single();
  if (error) fail('her settings', error);
  const p = row.parse(data);
  return {
    name: p.name,
    timezone: p.timezone,
    today: todayIn(p.timezone),
    defaultBufferDays: p.default_buffer_days,
    measurementUnit: p.measurement_unit as MeasurementUnit,
  };
}
