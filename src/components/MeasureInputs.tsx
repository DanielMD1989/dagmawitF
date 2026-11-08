import { TextField } from '@/components/fields';
import type { ActionState } from '@/lib/action-state';
import type { MeasurementField } from '@/domain/measurements/fields';
import { measureFieldName, type MeasurementUnit } from '@/domain/measurements/sets';

/**
 * Her measurements to fill in (decision 0102): her list in her order, two to a row, each saying its unit, and
 * "Extra" for what is not a number. Any left empty is not measured this time.
 */
export function MeasureInputs({
  fields,
  unit,
  state,
  startingValues = {},
}: {
  fields: MeasurementField[];
  unit: MeasurementUnit;
  state: ActionState;
  /** What the last version said, by field key. */
  startingValues?: Record<string, number>;
}) {
  return (
    <fieldset className="measure-set">
      <legend>Measurements ({unit})</legend>
      <div className="measure-grid">
        {fields.map((f) => {
          const name = measureFieldName(f.key);
          const start = startingValues[f.key];
          return (
            <TextField
              key={f.key}
              name={name}
              id={name}
              label={f.label}
              state={state}
              saved={start === undefined ? '' : String(start)}
              inputMode="decimal"
              autoComplete="off"
              placeholder={unit}
            />
          );
        })}
      </div>
      <TextField name="note" id="m-extra" label="Extra" state={state} autoComplete="off" maxLength={300} />
    </fieldset>
  );
}
