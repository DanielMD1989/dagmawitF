import type { Metadata } from 'next';
import Link from 'next/link';
import { formatDay } from '@/domain/dates';
import { isCurrent } from '@/domain/planning/proposal';
import { PLAN_STATUS_LABEL } from '@/domain/planning/words';
import { loadEpoch, loadPlanList } from '@/server/planning';
import { loadPreferences } from '@/server/preferences';
import { requireUser } from '@/server/session';
import { createSupabase } from '@/server/supabase';

export const metadata: Metadata = { title: 'Plans' };

/** The approved plan, open proposals, and the plans before them. */
export default async function PlansPage() {
  await requireUser();
  const supabase = await createSupabase();
  const [plans, epoch, prefs] = await Promise.all([
    loadPlanList(supabase),
    loadEpoch(supabase),
    loadPreferences(supabase),
  ]);
  const approved = plans.find((p) => p.status === 'approved') ?? null;
  const open = plans.filter((p) => p.status === 'proposed');
  const earlier = plans.filter((p) => p.status !== 'approved' && p.status !== 'proposed');

  const row = (p: (typeof plans)[number], note: string) => (
    <li key={p.number}>
      <Link href={`/plan/${p.number}`} className="row-link">
        <span className="row-link__title">Plan {p.number}</span>
        <span className="hint">
          Made for {formatDay(p.madeFor)}
          {p.baseNumber !== null && `, after plan ${p.baseNumber}`}
          {note && ` · ${note}`}
        </span>
        <span className="row-link__side">
          <span className={p.status === 'approved' ? 'chip' : 'chip chip--line'}>
            {PLAN_STATUS_LABEL[p.status]}
          </span>
        </span>
      </Link>
    </li>
  );

  return (
    <>
      <div className="page-head">
        <p className="crumbs">
          <Link href="/planner">Planner</Link> / Plans
        </p>
        <h1>Plans</h1>
        <p className="lede">
          A plan covers every active order, because they share her hours. Make a proposal from an order’s Plan
          tab, read it, then approve it.
        </p>
      </div>

      <section className="section" aria-labelledby="approved-heading">
        <div className="section__head">
          <h2 id="approved-heading">Approved</h2>
        </div>
        {approved ? (
          <ul className="rows rows--links">
            {row(
              approved,
              isCurrent(approved, epoch, prefs.today)
                ? 'up to date'
                : 'out of date: things have changed since',
            )}
          </ul>
        ) : (
          <div className="card">
            <p>No plan has been approved yet.</p>
          </div>
        )}
      </section>

      {open.length > 0 && (
        <section className="section" aria-labelledby="open-heading">
          <div className="section__head">
            <h2 id="open-heading">Waiting for her decision</h2>
          </div>
          <ul className="rows rows--links">
            {open.map((p) => row(p, isCurrent(p, epoch, prefs.today) ? '' : 'out of date: make a new one'))}
          </ul>
        </section>
      )}

      {earlier.length > 0 && (
        <section className="section" aria-labelledby="earlier-heading">
          <div className="section__head">
            <h2 id="earlier-heading">Earlier</h2>
          </div>
          <ul className="rows rows--links">{earlier.map((p) => row(p, ''))}</ul>
        </section>
      )}
    </>
  );
}
