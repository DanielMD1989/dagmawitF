import { formatDay } from '@/domain/dates';
import type { MeasurementField } from '@/domain/measurements/fields';
import {
  changesBetween,
  formatDelta,
  formatMeasure,
  measureLines,
  type MeasurementSet,
} from '@/domain/measurements/sets';

/**
 * A client's saved measurements, newest version first. Each version opens to show its numbers, and says what
 * changed since the version before it (when both were taken in the same unit, so the difference means something).
 */
export function MeasurementVersions({
  sets,
  fields,
}: {
  sets: MeasurementSet[];
  fields: MeasurementField[];
}) {
  return (
    <ul className="rows">
      {sets.map((set, index) => {
        const before = sets[index + 1];
        const changes =
          before && before.unit === set.unit ? changesBetween(before.measures, set.measures, fields) : null;
        return (
          <li key={set.id}>
            <details className="disclosure disclosure--link">
              <summary>
                Version {set.version} · taken {formatDay(set.takenOn)} · {set.unit}
              </summary>
              <div className="disclosure__panel">
                {set.note && <p>{set.note}</p>}
                <dl className="measures">
                  {measureLines(set.measures, fields).map((line) => (
                    <div key={line.key}>
                      <dt>{line.label}</dt>
                      <dd>{formatMeasure(line.value, set.unit)}</dd>
                    </div>
                  ))}
                </dl>
                {changes && changes.length > 0 && (
                  <div>
                    <p className="eyebrow">Changed since version {before!.version}</p>
                    <ul className="plain-list">
                      {changes.map((c) => (
                        <li key={c.key}>
                          {c.label}:{' '}
                          {c.from === null
                            ? `now ${formatMeasure(c.to!, set.unit)}`
                            : c.to === null
                              ? 'not measured this time'
                              : `${formatMeasure(c.from, set.unit)} → ${formatMeasure(c.to, set.unit)} (${formatDelta(c.from, c.to, set.unit)})`}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </details>
          </li>
        );
      })}
    </ul>
  );
}
