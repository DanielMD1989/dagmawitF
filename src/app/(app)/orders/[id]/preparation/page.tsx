import { notFound } from 'next/navigation';
import { isUuid } from '@/domain/form-input';
import {
  KIND_HEADING,
  KIND_ORDER,
  SUGGESTIONS,
  describeReadiness,
  readinessWarnings,
  readiness,
  readyCount,
} from '@/domain/orders/prerequisites';
import { isClosed, isPlanned } from '@/domain/orders/status';
import { getOrder, loadPrerequisites } from '@/server/orders';
import { loadPreferences } from '@/server/preferences';
import { requireUser } from '@/server/session';
import { createSupabase } from '@/server/supabase';
import { AddPrerequisiteForm } from './AddPrerequisiteForm';
import { PrerequisiteItem } from './PrerequisiteItem';
import { Suggestions } from './Suggestions';

/** What this order is waiting for: fabric to arrive, a design to be approved, a fitting to be agreed. */
export default async function OrderPreparationPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const order = await getOrder(id);
  if (!order) notFound();

  const supabase = await createSupabase();
  const [items, prefs] = await Promise.all([
    loadPrerequisites(supabase, order.id),
    loadPreferences(supabase),
  ]);
  const status = readiness(items, prefs.today);
  const warnings = readinessWarnings(status);
  const editable = !isClosed(order.status);
  const present = new Set(items.map((i) => i.label.toLowerCase()));
  const suggestions = SUGGESTIONS.map((s) => s.label).filter((label) => !present.has(label.toLowerCase()));
  const percent = status.total === 0 ? 0 : Math.round((status.ready / status.total) * 100);

  return (
    <>
      <section className="section" aria-labelledby="readiness-heading">
        <div className="card readiness">
          <div>
            <h2 id="readiness-heading" className="big-number">
              {readyCount(status)}
            </h2>
            <p className="hint">{describeReadiness(status)}</p>
          </div>
          <div>
            <div
              className="meter"
              role="progressbar"
              aria-labelledby="readiness-heading"
              aria-valuemin={0}
              aria-valuemax={status.total}
              aria-valuenow={status.ready}
            >
              <span style={{ width: `${percent}%` }} />
            </div>
            {warnings.length > 0 && (
              <p className={status.overdue > 0 ? 'late' : 'attention'} role="status">
                {warnings.join('. ')}.
              </p>
            )}
          </div>
        </div>
        <p className="hint">
          Work that depends on an item cannot be planned until the item is in or has a date. Record when
          something is ordered and when it is expected, and the plan can be built around it.
        </p>
      </section>

      {editable && <Suggestions orderId={order.id} labels={suggestions} />}

      {items.length > 0 && (
        <div className="groups">
          {KIND_ORDER.map((kind) => {
            const group = items.filter((i) => i.kind === kind);
            if (group.length === 0) return null;
            return (
              <section key={kind} className="section" aria-labelledby={`group-${kind}`}>
                <div className="section__head">
                  <h2 id={`group-${kind}`}>{KIND_HEADING[kind]}</h2>
                </div>
                <ul className="items">
                  {group.map((item) => (
                    <PrerequisiteItem
                      key={item.id}
                      item={item}
                      today={prefs.today}
                      editable={editable}
                      orderId={order.id}
                      impact={isPlanned(order.status)}
                    />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      {editable ? (
        <AddPrerequisiteForm orderId={order.id} />
      ) : (
        <p className="hint">
          This order is {order.status === 'delivered' ? 'delivered' : 'cancelled'}. Reopen it to change the
          list.
        </p>
      )}
    </>
  );
}
