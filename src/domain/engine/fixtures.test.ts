import { describe, expect, it } from 'vitest';
import { diff } from './diff';
import { ALL_FIXTURES, bridalGown, bridalGownLaceLate, busyAtelier, impossibleDress } from './fixtures';
import { plan } from './plan';
import { renderDiff, renderPlan } from './render';
import type { Plan } from './types';

function run(f: { input: Parameters<typeof plan>[0] }): Plan {
  const result = plan(f.input);
  if (!result.ok) throw new Error(result.errors.map((e) => e.message).join(' | '));
  return result.plan;
}
const slots = (p: Plan, id: string) =>
  p.slots.filter((s) => s.taskId === id).map((s) => `${s.day}:${s.minutes}`);
const task = (p: Plan, id: string) => p.tasks.find((t) => t.id === id);

describe.each(ALL_FIXTURES)('sample: $name', (fixture) => {
  it('plans without being refused', () => {
    expect(plan(fixture.input).ok).toBe(true);
  });

  it('is repeatable', () => {
    expect(JSON.stringify(plan(fixture.input))).toBe(JSON.stringify(plan(fixture.input)));
  });

  it('reads as plain words, with no leftovers of code', () => {
    const text = renderPlan(fixture.input, run(fixture));
    expect(text).toContain('PLAN FOR');
    expect(text).toContain('DAY BY DAY');
    expect(text).not.toMatch(/undefined|NaN|\[object|Infinity/);
  });
});

describe('the bridal gown story, from the first pattern to the last stitch', () => {
  const p = run(bridalGown);

  it('is on track, with the last working day a day after it is ready', () => {
    expect(p.orders[0]).toMatchObject({
      id: 'o105',
      state: 'on_track',
      readyOn: '2026-11-16',
      lastWorkDay: '2026-11-17',
      slackDays: 1,
      complete: true,
    });
    expect(p.warnings).toEqual([]);
  });

  it('spreads the 10 hour construction over three working days, 5h 15m at most a day', () => {
    expect(slots(p, 'construct')).toEqual(['2026-10-30:135', '2026-11-02:315', '2026-11-03:150']);
    expect(slots(p, 'construct').reduce((sum, s) => sum + Number(s.split(':')[1]), 0)).toBe(600);
  });

  it('keeps both fittings where the client set them, with their clock times', () => {
    expect(p.slots.filter((s) => s.taskId === 'fit1')).toEqual([
      { taskId: 'fit1', day: '2026-10-29', minutes: 60, time: '10:30', rank: 1 },
    ]);
    expect(p.slots.filter((s) => s.taskId === 'fit2')).toEqual([
      { taskId: 'fit2', day: '2026-11-12', minutes: 60, time: '10:30', rank: 1 },
    ]);
  });

  it('cuts only after the first fitting and a night, and finishes only after the second', () => {
    expect(task(p, 'cut')?.start).toBe('2026-10-30');
    expect(task(p, 'alter')?.start).toBe('2026-11-13');
    expect(task(p, 'finish')?.finish).toBe('2026-11-16');
  });

  it('lets the gown rest overnight using days and none of her time', () => {
    expect(task(p, 'rest')).toMatchObject({ start: '2026-11-03', finish: '2026-11-04' });
    expect(p.slots.some((s) => s.taskId === 'rest')).toBe(false);
  });

  it('uses the day the lace arrives for the trims, ahead of when they are needed', () => {
    expect(slots(p, 'trims')).toEqual(['2026-10-28:45']);
    expect(task(p, 'trims')?.slackDays).toBe(20);
  });

  it('names the chain that sets the ready day, in order', () => {
    expect(p.critical).toEqual([
      'pattern',
      'toile',
      'fit1',
      'cut',
      'construct',
      'rest',
      'fit2',
      'alter',
      'finish',
    ]);
  });

  it('never uses a weekend', () => {
    for (const s of p.slots) expect([0, 6]).not.toContain(new Date(`${s.day}T00:00:00Z`).getUTCDay());
  });
});

describe('when the lace is late', () => {
  const before = run(bridalGown);
  const after = run(bridalGownLaceLate);

  it('puts the order at risk and says why, naming the lace', () => {
    expect(after.orders[0]?.state).toBe('at_risk');
    const codes = after.orders[0]?.reasons.map((r) => r.code);
    expect(codes).toEqual(expect.arrayContaining(['buffer_used', 'task_after_latest_finish']));
    const late = after.warnings.find((w) => w.code === 'task_after_latest_finish');
    expect(late?.numbers).toMatchObject({ waitingFor: 'French lace', expectedOn: '2026-11-19', lateDays: 2 });
    expect(late?.message).toContain('French lace');
  });

  it('shows what moved: the trims and the finishing, three days later in all', () => {
    const d = diff(before, after);
    expect(d.moved.map((m) => m.taskId)).toEqual(['finish', 'trims']);
    expect(d.readyDateChanges).toEqual([
      { orderId: 'o105', before: '2026-11-16', after: '2026-11-19', days: 3 },
    ]);
    expect(d.newlyAtRisk).toEqual([{ orderId: 'o105', before: 'on_track', after: 'at_risk' }]);
  });

  it('tells the story in words', () => {
    const text = renderDiff(bridalGownLaceLate.input, diff(before, after));
    expect(text).toContain('Prepare bridal trims: Wed 28 Oct -> Thu 19 Nov');
    expect(text).toContain('3 days later');
    expect(text).toContain('AT RISK');
  });
});

describe('a busy fortnight', () => {
  const p = run(busyAtelier);
  const planned = (id: string) =>
    p.slots.filter((s) => s.taskId === id).reduce((sum, s) => sum + s.minutes, 0);

  it('plans every minute of every task', () => {
    for (const t of busyAtelier.input.tasks) {
      if (t.kind === 'work' || t.kind === 'fixed') expect(planned(t.id)).toBe(t.minutes);
    }
  });

  it('keeps all four orders on track, with studio jobs only in what is left', () => {
    expect(p.orders.map((o) => [o.id, o.state])).toEqual([
      ['o098', 'on_track'],
      ['o101', 'on_track'],
      ['o104', 'on_track'],
      ['o105', 'on_track'],
    ]);
    const lastOrderTask = Math.max(
      ...p.tasks.filter((t) => t.orderId !== null && t.finish).map((t) => Date.parse(t.finish as string)),
    );
    expect(Date.parse(task(p, 'studio-samples')?.start as string)).toBeLessThan(lastOrderTask);
  });

  it('lists tomorrow with the fitting first, then the work in the order she can do it', () => {
    const monday = p.slots.filter((s) => s.day === '2026-10-26');
    expect(monday[0]).toMatchObject({ taskId: 'o098-fit', time: '10:30', rank: 1 });
    const order = monday.map((s) => s.taskId);
    expect(order.indexOf('o098-alter')).toBeLessThan(order.indexOf('o098-press'));
  });

  it('fits every day within her planned time', () => {
    const perDay = new Map<string, number>();
    for (const s of p.slots) perDay.set(s.day, (perDay.get(s.day) ?? 0) + s.minutes);
    for (const [day, minutes] of perDay) expect(minutes, day).toBeLessThanOrEqual(315);
  });
});

describe('a dress that cannot be made', () => {
  const p = run(impossibleDress);

  it('says so plainly, with the hours it needs and the hours she has', () => {
    expect(p.orders[0]?.state).toBe('infeasible');
    const w = p.warnings.find((x) => x.code === 'order_cannot_make_delivery');
    expect(w?.numbers).toMatchObject({
      workMinutes: 900,
      availableMinutes: 630,
      lateWorkingDays: 1,
      deliveryOn: '2026-10-28',
    });
    expect(w?.message).toContain('15h 00m');
    expect(w?.message).toContain('10h 30m');
  });

  it('is not hidden in the printed plan', () => {
    expect(renderPlan(impossibleDress.input, p)).toContain('CANNOT MAKE IT');
  });
});
