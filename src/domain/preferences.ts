import { type FieldErrors, type Result, text } from './form-input';
import { isMeasurementUnit, type MeasurementUnit } from './measurements/sets';

/** What a new set of measurements starts from. */
export interface MeasurementDefaults {
  measurementUnit: MeasurementUnit;
}

/** The "measurements" form in Settings. */
export function parseMeasurementDefaults(data: FormData): Result<MeasurementDefaults> {
  const errors: FieldErrors = {};
  const unit = text(data, 'measurement-unit');
  if (!isMeasurementUnit(unit)) errors['measurement-unit'] = 'Choose centimetres or inches.';
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { measurementUnit: unit as MeasurementUnit } };
}
