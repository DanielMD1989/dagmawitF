import { type FieldErrors, type Result, text } from './form-input';
import { isMeasurementUnit, type MeasurementUnit } from './measurements/sets';
import { readBuffer } from './orders/forms';

/** What a new order and a new set of measurements start from. She can still change them for one order. */
export interface OrderDefaults {
  defaultBufferDays: number;
  measurementUnit: MeasurementUnit;
}

/** The "orders and measurements" form in Settings. */
export function parseOrderDefaults(data: FormData): Result<OrderDefaults> {
  const errors: FieldErrors = {};
  const defaultBufferDays = readBuffer(data, 'default-buffer-days', null, errors);
  const unit = text(data, 'measurement-unit');
  if (!isMeasurementUnit(unit)) errors['measurement-unit'] = 'Choose centimetres or inches.';
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { defaultBufferDays, measurementUnit: unit as MeasurementUnit } };
}
