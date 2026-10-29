/**
 * A length of time as two fields, hours and minutes, the way she says it ("2 hours 30"). Read back with
 * `readEstimate` (src/domain/planning/forms.ts); its error is keyed `<prefix>-hours`.
 */
export function HoursMinutes({
  prefix,
  id,
  legend,
  error,
  hours,
  minutes,
}: {
  prefix: string;
  /** Unique on the page: the fields' and the error's ids start with it. */
  id: string;
  legend: string;
  error: string | undefined;
  hours: string;
  minutes: string;
}) {
  return (
    <fieldset className="field" aria-describedby={error ? `${id}-${prefix}-error` : undefined}>
      <legend>{legend}</legend>
      <div className="pair">
        <label className="pair__part">
          <input
            name={`${prefix}-hours`}
            id={`${id}-${prefix}-hours`}
            className="input"
            type="number"
            inputMode="numeric"
            min={0}
            max={100}
            defaultValue={hours}
            aria-invalid={Boolean(error)}
          />
          <span>hours</span>
        </label>
        <label className="pair__part">
          <input
            name={`${prefix}-minutes`}
            id={`${id}-${prefix}-minutes`}
            className="input"
            type="number"
            inputMode="numeric"
            min={0}
            max={59}
            step={5}
            defaultValue={minutes}
            aria-invalid={Boolean(error)}
          />
          <span>minutes</span>
        </label>
      </div>
      {error && (
        <p id={`${id}-${prefix}-error`} className="error">
          {error}
        </p>
      )}
    </fieldset>
  );
}
