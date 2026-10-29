import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatDay } from '@/domain/dates';
import { formatMinutes } from '@/domain/duration';
import { asId, parseWholeNumber } from '@/domain/form-input';
import { isCurrent } from '@/domain/planning/proposal';
import {
  causeCount,
  changesAgainst,
  planOrders,
  reviewOrder,
  taskMoves,
  type Finding,
} from '@/domain/planning/review';
import { KIND_NAME, PLAN_STATUS_LABEL } from '@/domain/planning/words';
import { loadApprovedPlan, loadEpoch, loadPlanVersion } from '@/server/planning';
import { loadPreferences } from '@/server/preferences';
import { requireUser } from '@/server/session';
import { createSupabase } from '@/server/supabase';
import { MakeProposalForm } from '@/app/(app)/orders/[id]/plan/PlanForms';
import { PlanDecision } from './PlanDecision';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ number: string }>;
}): Promise<Metadata> {
  return { title: `Plan ${(await params).number}` };
}

/** Where a finding is put right. */
function fixFor(f: Finding, orderId: string): { href: string; label: string } | null {
  if (f.code === 'prerequisite_undated' || f.code === 'fixed_before_prerequisite')
    return { href: `/orders/${orderId}/preparation`, label: 'Open preparation' };
  if (f.taskId) return { href: `/orders/${orderId}/plan#task-${f.taskId}`, label: 'Change the task' };
  return null;
}

const STATE_CHIP = { on_track: 'chip', at_risk: 'chip chip--sand', infeasible: 'chip chip--warn' } as const;

export default async function PlanReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ number: string }>;
  searchParams: Promise<{ order?: string }>;
}) {
  await requireUser();
  const number = parseWholeNumber((await params).number);
  if (number === null || number < 1) notFound();
  const orderId = asId((await searchParams).order);

  const supabase = await createSupabase();
  const [version, approved, epoch, prefs] = await Promise.all([
    loadPlanVersion(supabase, number),
    loadApprovedPlan(supabase),
    loadEpoch(supabase),
    loadPreferences(supabase),
  ]);
  if (!version) notFound();

  const review = orderId ? reviewOrder(version.stored, version.slots, orderId) : null;
  const open = version.status === 'proposed';
  const current = isCurrent(version, epoch, prefs.today);
  const base = approved && approved.number !== version.number ? approved : null;
  const changes = open ? changesAgainst(base, version) : [];
  const findings = causeCount(version.stored);
  const moves = open && base ? taskMoves(base, version) : [];
  const ownMoves = orderId ? moves.filter((m) => m.orderId === orderId) : [];
  const otherMoves = moves.filter((m) => !orderId || m.orderId !== orderId);
  const labelOf = (id: string | null) =>
    id === null ? 'Studio work' : (version.stored.facts.orders.find((o) => o.id === id)?.label ?? 'An order');
  const otherOrders = [...new Set(otherMoves.map((m) => m.orderId))];

  return (
    <>
      <div className="page-head">
        <p className="crumbs">
          <Link href="/plan">Plans</Link>
          {review && (
            <>
              {' '}
              / <Link href={`/orders/${review.id}/plan`}>{review.label}</Link>
            </>
          )}{' '}
          / Plan {version.number}
        </p>
        <div className="title-row">
          <h1>{open ? 'Review the proposed plan' : `Plan ${version.number}`}</h1>
          <span className={version.status === 'approved' ? 'chip' : 'chip chip--line'}>
            {PLAN_STATUS_LABEL[version.status]}
          </span>
        </div>
        <p className="lede">
          {open ? `Proposal ${version.number}` : `Plan ${version.number}`}
          {version.baseNumber !== null
            ? `, built on approved plan ${version.baseNumber}`
            : ', the first plan'}
          . Made for {formatDay(version.madeFor)}, for every active order.
        </p>
      </div>

      {open && !current && (
        <div className="card card--warn" role="status">
          <p>
            Something has changed since this proposal was made, or it was made for an earlier day, so it can
            no longer be approved.
          </p>
          {orderId && <MakeProposalForm orderId={orderId} label="Make a new proposal" />}
        </div>
      )}

      {review && (
        <>
          <section className="section" aria-label="This order">
            <div className="stats">
              <div className="card stat">
                <p className="eyebrow">Order state</p>
                {review.taskCount === 0 ? (
                  <>
                    <span className="chip chip--line">No tasks yet</span>
                    <p className="hint">Give it a template on its Plan tab, then make a new proposal.</p>
                  </>
                ) : (
                  <>
                    <span className={STATE_CHIP[review.state]}>{review.stateLabel}</span>
                    <p className="hint">Worked out from the findings below.</p>
                  </>
                )}
              </div>
              <div className="card stat">
                <p className="eyebrow">Work placed</p>
                <p className="big-number">{formatMinutes(review.placedMinutes)}</p>
                <p className="hint">of {formatMinutes(review.neededMinutes)} of her time.</p>
              </div>
              <div className="card stat">
                <p className="eyebrow">Ready</p>
                <p className="big-number">{review.readyOn ? formatDay(review.readyOn) : 'Not yet'}</p>
                <p className="hint">
                  Handover {formatDay(review.deliveryOn)}. Last working day {formatDay(review.lastWorkDay)}.
                </p>
              </div>
            </div>
          </section>

          <section className="section" aria-labelledby="attention-heading">
            <div className="section__head">
              <h2 id="attention-heading">Needs your attention</h2>
            </div>
            {review.attention.length === 0 ? (
              <div className="card">
                <p>Nothing. Every task is placed, in time.</p>
              </div>
            ) : (
              <ul className="items">
                {review.attention.map((f, i) => {
                  const fix = fixFor(f, review.id);
                  return (
                    <li
                      key={`${f.code}-${f.taskId ?? i}`}
                      className={f.severity === 'problem' ? 'item item--late' : 'item item--undated'}
                    >
                      {review.garments.length > 1 && f.garment && <p className="eyebrow">{f.garment}</p>}
                      <p className="item__note">{f.message}</p>
                      {fix && (
                        <Link href={fix.href} className="btn btn--quiet btn--small">
                          {fix.label}
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {review.consequences.length > 0 && (
              <details className="disclosure disclosure--link">
                <summary>
                  {review.consequences.length} more task
                  {review.consequences.length === 1 ? ' waits' : 's wait'} behind these
                </summary>
                <div className="disclosure__panel">
                  <ul className="plain-list hint">
                    {review.consequences.map((f, i) => (
                      <li key={`${f.taskId ?? i}`}>
                        {review.garments.length > 1 && f.garment ? `${f.garment}: ` : ''}
                        {f.message}
                      </li>
                    ))}
                  </ul>
                </div>
              </details>
            )}
            {review.information.length > 0 && (
              <ul className="plain-list hint">
                {review.information.map((f, i) => (
                  <li key={`${f.code}-${i}`}>{f.message}</li>
                ))}
              </ul>
            )}
          </section>

          <section className="section" aria-labelledby="schedule-heading">
            <div className="section__head">
              <h2 id="schedule-heading">Proposed schedule</h2>
              <p className="hint">
                Planned by day. The order of work inside a day comes on My Day; only appointments have a clock
                time.
              </p>
            </div>
            <div className="table-wrap" tabIndex={0} role="region" aria-labelledby="schedule-heading">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Task</th>
                    <th scope="col">Kind</th>
                    <th scope="col">Estimate</th>
                    <th scope="col">Planned</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {review.schedule.map((r) => (
                    <tr key={r.taskId}>
                      <th scope="row">
                        {r.title}
                        {review.garments.length > 1 && r.garment && (
                          <span className="hint table__sub">{r.garment}</span>
                        )}
                      </th>
                      <td>{KIND_NAME[r.kind]}</td>
                      <td>{r.estimate || '—'}</td>
                      <td>{r.planned || 'Not planned'}</td>
                      <td>
                        <span className={r.status.tone === 'ok' ? 'chip' : 'chip chip--warn'}>
                          {r.status.text}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {review.weeks.length > 0 && (
            <section className="section" aria-labelledby="capacity-heading">
              <div className="section__head">
                <h2 id="capacity-heading">Shared capacity</h2>
                <p className="hint">
                  Her usable time is her working hours times her planning share. Other orders already hold
                  part of it.
                </p>
              </div>
              <ul className="weeks">
                {review.weeks.map((w) => {
                  const total = Math.max(w.usable, w.thisOrder + w.otherOrders, 1);
                  const pct = (m: number) => `${(m / total) * 100}%`;
                  return (
                    <li key={w.week} className="week">
                      <div className="week__head">
                        <span className="week__title">Week of {formatDay(w.week)}</span>
                        <span className="hint">
                          {formatMinutes(w.thisOrder + w.otherOrders)} of {formatMinutes(w.usable)}
                        </span>
                      </div>
                      <div className="stack" aria-hidden="true">
                        <span className="stack__this" style={{ width: pct(w.thisOrder) }} />
                        <span className="stack__other" style={{ width: pct(w.otherOrders) }} />
                      </div>
                      <p className="hint">
                        This order {formatMinutes(w.thisOrder)} · other orders {formatMinutes(w.otherOrders)}{' '}
                        · still free {formatMinutes(w.free)}
                      </p>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </>
      )}

      {open && base && (
        <section className="section" aria-labelledby="changes-heading">
          <div className="section__head">
            <h2 id="changes-heading">What changes, compared with plan {base.number}</h2>
          </div>
          {changes.length === 0 ? (
            <div className="card">
              <p>No order’s state or ready day changes.</p>
            </div>
          ) : (
            <ul className="items">
              {changes.map((c) => (
                <li key={c.orderId} className={c.worse ? 'item item--late' : 'item'}>
                  <span className="item__title">
                    <Link href={`/plan/${version.number}?order=${c.orderId}`}>{c.label}</Link>
                  </span>
                  <span className={c.worse ? 'item__note' : 'hint'}>{c.text}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {open && base && (
        <section className="section" aria-labelledby="moves-heading">
          <div className="section__head">
            <h2 id="moves-heading">What moves</h2>
            <p className="hint">Each task whose days change, compared with plan {base.number}.</p>
          </div>
          {moves.length === 0 ? (
            <div className="card">
              <p>No task moves.</p>
            </div>
          ) : (
            <>
              {orderId && (
                <ul className="items">
                  {ownMoves.length === 0 ? (
                    <li className="item">
                      <span className="hint">No task of this order moves.</span>
                    </li>
                  ) : (
                    ownMoves.map((m) => (
                      <li
                        key={m.taskId}
                        className={m.change === 'no_longer_planned' ? 'item item--late' : 'item'}
                      >
                        <span className="item__title">{m.title}</span>
                        <span className="hint">
                          {review && review.garments.length > 1 && m.garment ? `${m.garment} · ` : ''}
                          {m.text}
                        </span>
                      </li>
                    ))
                  )}
                </ul>
              )}
              {otherOrders.map((id) => {
                const mine = otherMoves.filter((m) => m.orderId === id);
                return (
                  <details key={id ?? 'studio'} className="disclosure disclosure--link">
                    <summary>
                      {labelOf(id)}: {mine.length} task{mine.length === 1 ? ' moves' : 's move'}
                    </summary>
                    <div className="disclosure__panel">
                      <ul className="plain-list">
                        {mine.map((m) => (
                          <li key={m.taskId}>
                            {m.title}: {m.text}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </details>
                );
              })}
            </>
          )}
        </section>
      )}

      <section className="section" aria-labelledby="orders-heading">
        <div className="section__head">
          <h2 id="orders-heading">{review ? 'Every order in this plan' : 'Orders in this plan'}</h2>
        </div>
        {version.stored.orders.length === 0 ? (
          <div className="card">
            <p>No active orders: nothing to plan.</p>
          </div>
        ) : (
          <ul className="rows rows--links">
            {planOrders(version.stored).map((o) => (
              <li key={o.id}>
                <Link
                  href={`/plan/${version.number}?order=${o.id}`}
                  className="row-link"
                  aria-current={o.id === orderId ? 'true' : undefined}
                >
                  <span className="row-link__title">{o.label}</span>
                  <span className="hint">
                    {o.taskCount === 0
                      ? 'No tasks yet'
                      : o.readyOn
                        ? `Ready ${formatDay(o.readyOn)}`
                        : 'Not all of it planned'}{' '}
                    · handover {formatDay(o.deliveryOn)}
                  </span>
                  <span className="row-link__side">
                    {o.taskCount === 0 ? (
                      <span className="chip chip--line">No tasks yet</span>
                    ) : (
                      <span className={STATE_CHIP[o.state]}>{o.stateLabel}</span>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {open && current && (
        <section className="section" aria-labelledby="decide-heading">
          <div className="section__head">
            <h2 id="decide-heading">Decide</h2>
            <p className="hint">
              Nothing moves until you approve.{' '}
              {base ? `Approving keeps plan ${base.number} in the history. ` : ''}
              Orders stay marked at risk until what they need is resolved.
            </p>
          </div>
          <PlanDecision number={version.number} orderId={orderId} findings={findings} />
        </section>
      )}
    </>
  );
}
