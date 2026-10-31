import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { todayIn, type IsoDate } from '@/domain/dates';
import { isMeasurementUnit, type MeasurementUnit } from '@/domain/measurements/sets';
import { requireUser } from './session';
import { fail } from './rows';

const row = z.object({
  name: z.string(),
  timezone: z.string(),
  measurement_unit: z.string().refine(isMeasurementUnit),
});

/** What the job and measurement screens need to know about her. */
export interface Preferences {
  name: string;
  timezone: string;
  /** Today on her wall clock, not the server's. */
  today: IsoDate;
  measurementUnit: MeasurementUnit;
}

export async function loadPreferences(supabase: SupabaseClient): Promise<Preferences> {
  // Her own profile: the people of a workspace can read each other's (decision 0081).
  const me = await requireUser();
  const { data, error } = await supabase
    .from('profile')
    .select('name, timezone, measurement_unit')
    .eq('owner_id', me.id)
    .single();
  if (error) fail('her settings', error);
  const p = row.parse(data);
  return {
    name: p.name,
    timezone: p.timezone,
    today: todayIn(p.timezone),
    measurementUnit: p.measurement_unit as MeasurementUnit,
  };
}
