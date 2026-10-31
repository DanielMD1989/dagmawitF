// Sends a notification to the phones of the other people of the caller's workspace (decision 0083).
//
// GET  → { publicKey }: the key a phone subscribes with (public by design).
// POST → { title, body, url } from the app's server, with the signed-in person's session (Authorization) and the
//        project's publishable key (apikey). The phones come from the database as that person
//        (workspace_push_targets), so a session can only ever reach its own workspace. A phone the push service says
//        is gone is dropped.
//
// The signing key pair is made once by the Database workflow and kept in this function's secrets; it is never in the
// repository or anywhere else.
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'npm:@supabase/supabase-js@2.49.4';

const publicKey = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
const privateKey = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
const subject = Deno.env.get('VAPID_SUBJECT') ?? 'https://dagmawit-f.vercel.app';
if (publicKey && privateKey) webpush.setVapidDetails(subject, publicKey, privateKey);

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

const text = (value: unknown, most: number) => (typeof value === 'string' ? value.slice(0, most) : '');

Deno.serve(async (request) => {
  if (!publicKey || !privateKey) return json({ error: 'notifications are not set up' }, 503);
  if (request.method === 'GET') return json({ publicKey });
  if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const authorization = request.headers.get('authorization') ?? '';
  const apikey = request.headers.get('apikey') ?? '';
  if (!authorization.startsWith('Bearer ') || !apikey) return json({ error: 'sign in' }, 401);

  let message: { title: string; body: string; url: string };
  try {
    const raw = await request.json();
    message = { title: text(raw.title, 100), body: text(raw.body, 300), url: text(raw.url, 200) };
  } catch {
    return json({ error: 'not json' }, 400);
  }
  if (!message.title || !message.url.startsWith('/')) return json({ error: 'bad message' }, 400);

  const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', apikey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const targets = await supabase.rpc('workspace_push_targets');
  if (targets.error) return json({ error: 'sign in' }, 401);

  let sent = 0;
  await Promise.all(
    (targets.data as { endpoint: string; p256dh: string; auth: string }[]).map(async (t) => {
      try {
        await webpush.sendNotification(
          { endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } },
          JSON.stringify(message),
          { TTL: 60 * 60 * 24, urgency: 'normal' },
        );
        sent += 1;
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410)
          await supabase.rpc('drop_push_subscription', { p_endpoint: t.endpoint });
      }
    }),
  );
  return json({ sent });
});
