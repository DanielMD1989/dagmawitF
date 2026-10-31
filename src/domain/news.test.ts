import { describe, expect, it } from 'vitest';
import { newsMessage } from './news';

const headlines: Record<string, string> = { a: 'Megan · Bridal gown', b: 'Bazaar at the Hyatt' };
const headlineOf = (id: string) => headlines[id];

describe('what a phone is told', () => {
  it('says who changed which job, and what, in the history’s words', () => {
    expect(
      newsMessage(
        [{ orderId: 'a', action: 'delivery_changed', details: { from: '2026-11-19', to: '2026-11-21' } }],
        'Hanna',
        headlineOf,
      ),
    ).toEqual({
      title: 'Megan · Bridal gown',
      body: expect.stringMatching(/^Hanna: .*Sat 21 Nov/),
      url: '/orders/a',
    });
  });

  it('counts the rest of a run of changes to one job', () => {
    const m = newsMessage(
      [
        { orderId: 'a', action: 'task_done', details: { title: 'Cutting', done_on: '2026-11-02' } },
        { orderId: 'a', action: 'task_done', details: { title: 'Sewing', done_on: '2026-11-02' } },
      ],
      'Hanna',
      headlineOf,
    );
    expect(m?.body).toMatch(/^Hanna: .*Cutting.* And 1 more change\.$/);
  });

  it('sums up changes to several jobs', () => {
    expect(
      newsMessage(
        [
          { orderId: 'a', action: 'task_done', details: { title: 'Cutting' } },
          { orderId: 'b', action: 'order_created', details: { number: 7 } },
        ],
        'Hanna',
        headlineOf,
      ),
    ).toEqual({ title: 'DAGMAWIT', body: 'Hanna changed 2 jobs.', url: '/orders' });
  });

  it('says nothing for lines it cannot word', () => {
    expect(newsMessage([{ orderId: 'a', action: 'nonsense', details: {} }], 'Hanna', headlineOf)).toBeNull();
    expect(newsMessage([], 'Hanna', headlineOf)).toBeNull();
  });
});
