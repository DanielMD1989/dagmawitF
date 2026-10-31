import 'server-only';
import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { z } from 'zod';
import { jobHeadline } from '@/domain/jobs/words';
import { newsMessage } from '@/domain/news';
import { loadPreferences } from './preferences';
import { createSupabase } from './supabase';

/**
 * Phone notifications (decision 0083). After a change, the history lines its person made are worded and sent, by the
 * `push` Edge Function, to the phones of the other people of the workspace. Never in the way: it runs after the
 * answer has gone, and a failure only means no notification.
 */

const functionUrl = () => `${process.env.SUPABASE_URL ?? ''}/functions/v1/push`;
const apikey = () => process.env.SUPABASE_PUBLISHABLE_KEY ?? '';

const newsRow = z.object({
  seq: z.coerce.number(),
  order_id: z.string().nullable(),
  action: z.string(),
  details: z.record(z.string(), z.unknown()),
});

/** What a change refreshes, and the news of it for the others. Use it where a change used revalidatePath. */
export function changed(path: string, type?: 'layout' | 'page'): void {
  revalidatePath(path, type);
  after(announce);
}

async function announce(): Promise<void> {
  try {
    const supabase = await createSupabase();
    const claimed = await supabase.rpc('claim_my_news');
    if (claimed.error || !claimed.data?.length) return;
    const lines = z.array(newsRow).parse(claimed.data);
    const jobs = [...new Set(lines.map((l) => l.order_id).filter((id): id is string => id !== null))];
    const [me, orders] = await Promise.all([
      loadPreferences(supabase),
      supabase.from('orders').select('id, number, title, client:client(name)').in('id', jobs),
    ]);
    const headlines = new Map(
      (orders.data ?? []).map((o) => {
        const client = o.client as unknown as { name: string } | null;
        return [
          o.id as string,
          jobHeadline({ number: o.number, title: o.title, clientName: client?.name ?? null }),
        ];
      }),
    );
    const message = newsMessage(
      lines.map((l) => ({ orderId: l.order_id, action: l.action, details: l.details })),
      me.name,
      (id) => headlines.get(id),
    );
    if (!message) return;
    const session = await supabase.auth.getSession();
    const token = session.data.session?.access_token;
    if (!token) return;
    await fetch(functionUrl(), {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, apikey: apikey(), 'content-type': 'application/json' },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(8000),
    });
  } catch (error) {
    console.warn('Could not send the news of a change:', error);
  }
}

/** The key a phone subscribes with, or null while notifications are not set up. */
export async function pushPublicKey(): Promise<string | null> {
  try {
    const response = await fetch(functionUrl(), {
      headers: { apikey: apikey() },
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    const body = z.object({ publicKey: z.string().min(20) }).safeParse(await response.json());
    return body.success ? body.data.publicKey : null;
  } catch {
    return null;
  }
}
