import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { MeasurementField } from '@/domain/measurements/fields';
import { isMeasurementUnit, measuresValid, type MeasurementSet } from '@/domain/measurements/sets';
import { fail, isoDay, timestamp } from './rows';

const fieldRow = z.object({
  id: z.string(),
  key: z.string(),
  label: z.string(),
  sort: z.number().int(),
  archived: z.boolean(),
});

/** All of her measurement fields, the hidden ones too (saved measurements may still use them), in her order. */
export async function loadMeasurementFields(supabase: SupabaseClient): Promise<MeasurementField[]> {
  const { data, error } = await supabase
    .from('measurement_field')
    .select('id, key, label, sort, archived')
    .order('sort')
    .order('label')
    .limit(500);
  if (error) fail('her list of measurements', error);
  return z.array(fieldRow).parse(data);
}

const setRow = z.object({
  id: z.string(),
  client_id: z.string(),
  version: z.number().int(),
  taken_on: isoDay,
  unit: z.string().refine(isMeasurementUnit),
  measures: z.record(z.string(), z.number()).refine(measuresValid, 'measurements are not well formed'),
  note: z.string(),
  created_at: timestamp,
});

function toSet(r: z.infer<typeof setRow>): MeasurementSet {
  return {
    id: r.id,
    clientId: r.client_id,
    version: r.version,
    takenOn: r.taken_on,
    unit: r.unit as MeasurementSet['unit'],
    measures: r.measures,
    note: r.note,
    createdAt: r.created_at,
  };
}

const SET_COLUMNS = 'id, client_id, version, taken_on, unit, measures, note, created_at';

/** One client's measurements over time, newest version first. */
export async function loadMeasurementSets(
  supabase: SupabaseClient,
  clientId: string,
): Promise<MeasurementSet[]> {
  const { data, error } = await supabase
    .from('measurement_set')
    .select(SET_COLUMNS)
    .eq('client_id', clientId)
    .order('version', { ascending: false })
    .limit(200);
  if (error) fail('the measurements', error);
  return z.array(setRow).parse(data).map(toSet);
}
