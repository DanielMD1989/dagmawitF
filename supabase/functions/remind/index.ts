// Sends the reminders that are due (decision 0095): the morning summary and an hour before a timed step. Called every
// five minutes by the database's timer (app.schedule_reminders).
//
// It takes nothing from its caller: it asks the database what is due now (app.claim_due_reminders, which also notes
// each as sent), so whoever calls it can only make what is due go out, once. It connects with the database address
// Supabase gives every function (SUPABASE_DB_URL), never leaving Supabase; the signing keys are the push function's
// (decision 0083). A phone the push service says is gone is dropped.
import webpush from 'npm:web-push@3.6.7';
import postgres from 'npm:postgres@3.4.5';

const publicKey = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
const privateKey = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
const subject = Deno.env.get('VAPID_SUBJECT') ?? 'https://dagmawit-f.vercel.app';
const databaseUrl = Deno.env.get('SUPABASE_DB_URL') ?? '';
if (publicKey && privateKey) webpush.setVapidDetails(subject, publicKey, privateKey);

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

type Due = {
  endpoint: string;
  p256dh: string;
  auth: string;
  title: string;
  body: string;
  url: string;
  tag: string;
};

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  if (!publicKey || !privateKey || !databaseUrl) return json({ error: 'reminders are not set up' }, 503);

  // One connection per call, closed after: the timer calls every five minutes.
  const sql = postgres(databaseUrl, { max: 1, prepare: false, idle_timeout: 5 });
  try {
    const due = await sql<Due[]>`
      select endpoint, p256dh, auth, title, body, url, tag from app.claim_due_reminders()`;
    let sent = 0;
    const gone: string[] = [];
    await Promise.all(
      due.map(async (d) => {
        try {
          await webpush.sendNotification(
            { endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } },
            JSON.stringify({ title: d.title, body: d.body, url: d.url, tag: d.tag }),
            // A reminder is for now: a phone off for longer than an hour does not get it later.
            { TTL: 60 * 60, urgency: 'high' },
          );
          sent += 1;
        } catch (error) {
          const status = (error as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) gone.push(d.endpoint);
          else console.error('reminder not sent', status ?? error);
        }
      }),
    );
    if (gone.length > 0) await sql`delete from app.push_subscription where endpoint in ${sql(gone)}`;
    return json({ due: due.length, sent, dropped: gone.length });
  } catch (error) {
    console.error('reminders failed', error);
    return json({ error: 'reminders failed' }, 500);
  } finally {
    await sql.end({ timeout: 5 });
  }
});
