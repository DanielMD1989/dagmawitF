import { daysBetween, formatDay, type IsoDate } from '../dates';
import { formatMinutes } from '../duration';
import { compareText } from './model';
import type { OrderPlan, OrderState, Plan, PlanDiff, PlanInput } from './types';

/**
 * A plan written out in plain words, the way she would read it. Used by the print command and
 * by tests that check the text still reads sensibly. Pure: text in, text out.
 */

const STATE: Record<OrderState, string> = {
  on_track: 'On track',
  at_risk: 'AT RISK',
  infeasible: 'CANNOT MAKE IT',
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function renderPlan(input: PlanInput, plan: Plan): string {
  const lines: string[] = [];
  const orderLabel = new Map((input.orders ?? []).map((o) => [o.id, o.label]));
  const titleOf = new Map(input.tasks.map((t) => [t.id, t.title]));
  const orderOf = new Map(input.tasks.map((t) => [t.id, t.orderId]));
  const delivery = new Map((input.orders ?? []).map((o) => [o.id, o]));

  const counts = { on_track: 0, at_risk: 0, infeasible: 0 };
  for (const o of plan.orders) counts[o.state]++;
  lines.push(`PLAN FOR ${formatDay(plan.today)}`);
  lines.push(
    `${plural(plan.orders.length, 'order')}: ${counts.on_track} on track, ${counts.at_risk} at risk, ${counts.infeasible} cannot make it`,
  );

  lines.push('', 'ORDERS');
  for (const o of plan.orders) {
    lines.push(
      ...renderOrder(o, orderLabel.get(o.id) ?? o.id, delivery.get(o.id)?.deliveryOn ?? null, plan, titleOf),
    );
  }

  lines.push('', 'DAY BY DAY');
  const days = [...new Set(plan.slots.map((s) => s.day))].sort(compareText);
  for (const day of days) {
    const slots = plan.slots.filter((s) => s.day === day);
    const planned = slots.reduce((sum, s) => sum + s.minutes, 0);
    const index = daysBetween(input.calendar.start, day);
    const usable = input.calendar.usable[index] ?? 0;
    lines.push(`${formatDay(day)}   ${formatMinutes(planned)} of ${formatMinutes(usable)}`);
    for (const s of slots) {
      const owner = orderOf.get(s.taskId);
      const where = owner ? (orderLabel.get(owner) ?? owner) : 'Studio';
      const at = s.time ? `${s.time}  ` : '';
      lines.push(`    ${at}${titleOf.get(s.taskId) ?? s.taskId}   ${formatMinutes(s.minutes)}   (${where})`);
    }
  }

  const waits = plan.tasks.filter(
    (t) => t.placement === 'planned' && !plan.slots.some((s) => s.taskId === t.id),
  );
  const waiting = waits.filter((t) => t.start !== null && t.finish !== null);
  if (waiting.length > 0) {
    lines.push('', 'WAITS AND MARKERS (use days, not her hours)');
    for (const t of waiting) {
      lines.push(
        `    ${titleOf.get(t.id) ?? t.id}: ${formatDay(t.start as IsoDate)} to ${formatDay(t.finish as IsoDate)}`,
      );
    }
  }

  const notPlanned = plan.tasks.filter((t) => t.placement === 'unplanned');
  if (notPlanned.length > 0) {
    lines.push('', 'NOT IN THE PLAN');
    for (const t of notPlanned) {
      const why = plan.warnings.find((w) => w.taskId === t.id);
      lines.push(`    ${titleOf.get(t.id) ?? t.id}${why ? `: ${why.message}` : ''}`);
    }
  }

  const info = plan.warnings.filter((w) => w.severity === 'info');
  if (info.length > 0) {
    lines.push('', 'GOOD TO KNOW');
    for (const w of info) lines.push(`    ${w.message}`);
  }
  return lines.join('\n');
}

function renderOrder(
  o: OrderPlan,
  label: string,
  deliveryOn: IsoDate | null,
  plan: Plan,
  titleOf: Map<string, string>,
): string[] {
  const out: string[] = [];
  const facts: string[] = [];
  if (o.readyOn) facts.push(`ready ${formatDay(o.readyOn)}`);
  if (deliveryOn) facts.push(`handover ${formatDay(deliveryOn)}`);
  out.push(`${label}`, `    ${STATE[o.state]}${facts.length > 0 ? `   ${facts.join(', ')}` : ''}`);
  for (const r of o.reasons) out.push(`    - ${r.message}`);
  const chain = plan.tasks.filter((t) => t.orderId === o.id && t.critical);
  if (chain.length > 0) {
    out.push(
      `    Sets the ready day: ${plan.critical
        .filter((id) => chain.some((t) => t.id === id))
        .map((id) => titleOf.get(id) ?? id)
        .join(' > ')}`,
    );
  }
  return out;
}

/** What changed between two plans, in plain words. */
export function renderDiff(input: PlanInput, d: PlanDiff): string {
  const titleOf = new Map(input.tasks.map((t) => [t.id, t.title]));
  const orderLabel = new Map((input.orders ?? []).map((o) => [o.id, o.label]));
  const lines: string[] = ['WHAT CHANGED'];

  if (
    d.moved.length === 0 &&
    d.readyDateChanges.length === 0 &&
    d.newlyAtRisk.length === 0 &&
    d.recovered.length === 0
  ) {
    lines.push('    Nothing moved. Every task and every order is exactly as before.');
    return lines.join('\n');
  }
  for (const m of d.moved) {
    const title = titleOf.get(m.taskId) ?? m.taskId;
    const from = m.before ? span(m.before.start, m.before.finish) : 'not planned';
    const to = m.after ? span(m.after.start, m.after.finish) : 'not planned';
    lines.push(`    ${title}: ${from} -> ${to}`);
  }
  for (const c of d.readyDateChanges) {
    const label = orderLabel.get(c.orderId) ?? c.orderId;
    const from = c.before ? formatDay(c.before) : 'no ready day';
    const to = c.after ? formatDay(c.after) : 'no ready day';
    const by =
      c.days === null
        ? ''
        : c.days > 0
          ? ` (${plural(c.days, 'day')} later)`
          : ` (${plural(-c.days, 'day')} earlier)`;
    lines.push(`    ${label} is ready ${to} instead of ${from}${by}`);
  }
  for (const r of d.newlyAtRisk)
    lines.push(
      `    ${orderLabel.get(r.orderId) ?? r.orderId} is now ${STATE[r.after]} (it was ${STATE[r.before]})`,
    );
  for (const r of d.recovered)
    lines.push(
      `    ${orderLabel.get(r.orderId) ?? r.orderId} is back to ${STATE[r.after]} (it was ${STATE[r.before]})`,
    );
  return lines.join('\n');
}

function span(start: IsoDate, finish: IsoDate): string {
  return start === finish ? formatDay(start) : `${formatDay(start)} to ${formatDay(finish)}`;
}
