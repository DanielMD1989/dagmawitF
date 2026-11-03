import { describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import { actAs, actAsOwner, createUser, inTransaction } from './helpers';

// Reminders on her phone (decision 0095): the morning summary at 7:30 on her clock, and an hour before a step with a
// time, each sent once, to every phone of the workspace. Times are given, so the tests are the same on any day.

const D = '2030-03-04'; // her day; Addis Ababa is three hours ahead of UTC
const at = (day: string, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  const utc = new Date(`${day}T00:00:00Z`);
  utc.setUTCMinutes(h! * 60 + m! - 180);
  return utc.toISOString();
};

const one = async <T = Record<string, unknown>>(c: PoolClient, sql: string, params: unknown[] = []) =>
  (await c.query(sql, params)).rows[0] as T;

type Reminder = { endpoint: string; title: string; body: string; url: string };
const claim = async (c: PoolClient, when: string) => {
  await actAsOwner(c);
  return (
    await c.query<Reminder>(
      `select endpoint, title, body, url from app.claim_due_reminders($1::timestamptz) order by endpoint, title`,
      [when],
    )
  ).rows;
};

async function order(c: PoolClient, client: string, title: string, deliveryOn: string) {
  const clientId = (
    await one<{ id: string }>(c, `insert into public.client (name) values ($1) returning id`, [client])
  ).id;
  const id = (
    await one<{ id: string }>(
      c,
      `insert into public.orders (client_id, title, delivery_on) values ($1, $2, $3) returning id`,
      [clientId, title, deliveryOn],
    )
  ).id;
  await c.query(`update public.orders set status = 'active' where id = $1`, [id]);
  return id;
}

const step = (
  c: PoolClient,
  orderId: string | null,
  title: string,
  onDay: string,
  startsAt: string | null = null,
) =>
  c.query(`insert into public.task (order_id, title, on_day, starts_at) values ($1, $2, $3, $4)`, [
    orderId,
    title,
    onDay,
    startsAt,
  ]);

/** Her workspace, with Hanna added, and a phone each with notifications on. */
async function workspace(c: PoolClient) {
  const her = await createUser(c, 'dagmawit@example.test', 'Dagmawit');
  const hanna = await createUser(c, 'hanna@example.test', 'Hanna');
  await actAs(c, her);
  await c.query(`select public.add_member('hanna@example.test')`);
  const wedding = await order(c, 'Selam Bekele', 'Wedding guest dress', '2030-03-09');
  await order(c, 'Yonas Alemu', 'Hem trousers', D);
  await step(c, wedding, 'Fitting', D, '10:30');
  await step(c, wedding, 'Sewing', D);
  await step(c, wedding, 'Buy fabric', '2030-03-03');
  await step(c, null, 'Call the lace supplier', D, '09:00');
  await actAsOwner(c);
  for (const [user, n] of [
    [her, 1],
    [hanna, 2],
  ] as const)
    await c.query(
      `insert into app.push_subscription (endpoint, user_id, p256dh, auth) values ($1, $2, 'key', 'secret')`,
      [`https://push.example/${n}`, user],
    );
  return { her, wedding };
}

describe('the morning summary', () => {
  it('comes at 7:30 on her clock to every phone, saying what is on today, once', async () => {
    await inTransaction(async (c) => {
      await workspace(c);
      expect(await claim(c, at(D, '07:00'))).toEqual([]);
      const morning = await claim(c, at(D, '07:35'));
      expect(morning.map((r) => r.endpoint)).toEqual(['https://push.example/1', 'https://push.example/2']);
      expect(morning[0]).toMatchObject({ title: 'Today: 4 steps · 1 delivery', url: '/' });
      expect(morning[0]!.body.split('\n')).toEqual([
        'Buy fabric · Selam Bekele · Wedding guest dress (not done yet)',
        '09:00 Call the lace supplier',
        '10:30 Fitting · Selam Bekele · Wedding guest dress',
        'Sewing · Selam Bekele · Wedding guest dress',
        'and 1 more',
      ]);
      expect(await claim(c, at(D, '07:40'))).toEqual([]);
    });
  });

  it('is not sent late in the day, and keeps saying what is not done yet', async () => {
    await inTransaction(async (c) => {
      await workspace(c);
      expect((await claim(c, at(D, '11:05'))).filter((r) => r.title.startsWith('Today'))).toEqual([]);
      // Weeks later, what was not done is still said, as not done yet.
      const later = await claim(c, at('2030-03-20', '07:35'));
      expect(later[0]!.body).toContain('Fitting · Selam Bekele · Wedding guest dress (not done yet)');
    });
  });

  it('is not sent on a day with nothing on', async () => {
    await inTransaction(async (c) => {
      const her = await createUser(c, 'quiet@example.test', 'Dagmawit');
      await c.query(
        `insert into app.push_subscription (endpoint, user_id, p256dh, auth) values ('https://push.example/9', $1, 'key', 'secret')`,
        [her],
      );
      expect(await claim(c, at(D, '07:35'))).toEqual([]);
    });
  });
});

describe('an hour before a step with a time', () => {
  it('says what and whose, once, and not for a step done', async () => {
    await inTransaction(async (c) => {
      const { wedding } = await workspace(c);
      await claim(c, at(D, '07:35'));
      const lace = await claim(c, at(D, '08:10'));
      expect(lace).toEqual([
        {
          endpoint: 'https://push.example/1',
          title: 'At 09:00 · Call the lace supplier',
          body: 'Your own',
          url: '/',
        },
        {
          endpoint: 'https://push.example/2',
          title: 'At 09:00 · Call the lace supplier',
          body: 'Your own',
          url: '/',
        },
      ]);
      expect(await claim(c, at(D, '08:20'))).toEqual([]);
      const fitting = await claim(c, at(D, '09:45'));
      expect(fitting[0]).toEqual({
        endpoint: 'https://push.example/1',
        title: 'At 10:30 · Fitting',
        body: 'Selam Bekele · Wedding guest dress',
        url: `/orders/${wedding}`,
      });
      // After its time, nothing.
      expect(await claim(c, at(D, '10:40'))).toEqual([]);
    });
  });
});

describe('who gets them', () => {
  it('only phones with notifications on; a workspace with none is not even looked at', async () => {
    await inTransaction(async (c) => {
      await workspace(c);
      await actAsOwner(c);
      await c.query(`delete from app.push_subscription`);
      expect(await claim(c, at(D, '07:35'))).toEqual([]);
      expect(await one(c, `select count(*)::int as n from app.reminder_sent`)).toEqual({ n: 0 });
    });
  });

  it('is not open to the app: only the database owner can claim or switch on the timer', async () => {
    await inTransaction(async (c) => {
      const { her } = await workspace(c);
      await actAs(c, her);
      await expect(c.query(`select * from app.claim_due_reminders()`)).rejects.toThrow();
    });
    await inTransaction(async (c) => {
      const her = await createUser(c, 'x@example.test');
      await actAs(c, her);
      await expect(
        c.query(`select app.schedule_reminders('https://x.supabase.co/functions/v1/remind')`),
      ).rejects.toThrow();
    });
  });

  it('switches on only for a reminder address', async () => {
    await inTransaction(async (c) => {
      await actAsOwner(c);
      await expect(c.query(`select app.schedule_reminders('https://evil.example/remind')`)).rejects.toThrow(
        /not a reminder address/,
      );
    });
  });
});

describe('the timer', () => {
  it('is switched on every five minutes, once, where the database has pg_cron (her project, and CI)', async () => {
    await inTransaction(async (c) => {
      await actAsOwner(c);
      const has = await one<{ n: number }>(
        c,
        `select count(*)::int as n from pg_available_extensions where name in ('pg_cron', 'pg_net')`,
      );
      if (has.n < 2) return; // a plain PostgreSQL: nothing to switch on
      const url = 'https://abcdefgh.supabase.co/functions/v1/remind';
      await c.query(`select app.schedule_reminders($1)`, [url]);
      await c.query(`select app.schedule_reminders($1)`, [url]);
      const jobs = (
        await c.query(`select schedule, command from cron.job where jobname = 'dagmawit-reminders'`)
      ).rows as { schedule: string; command: string }[];
      expect(jobs).toHaveLength(1);
      expect(jobs[0]!.schedule).toBe('*/5 * * * *');
      expect(jobs[0]!.command).toContain(url);
    });
  });
});
