import { notFound } from 'next/navigation';
import { formatDayLong, wallClockOf, type IsoDate } from '@/domain/dates';
import { isUuid } from '@/domain/form-input';
import { describeEvent } from '@/domain/orders/history';
import { getOrder, loadHistory } from '@/server/orders';
import { loadPreferences } from '@/server/preferences';
import { requireUser } from '@/server/session';
import { createSupabase } from '@/server/supabase';

/** What happened to this order, newest first. The database writes every line, so nothing is missing. */
export default async function OrderHistoryPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const order = await getOrder(id);
  if (!order) notFound();

  const supabase = await createSupabase();
  const [events, prefs] = await Promise.all([loadHistory(supabase, order.id), loadPreferences(supabase)]);

  // Group by the day it happened on her clock, keeping the newest first.
  const days: { day: IsoDate; lines: { seq: number; time: string; text: string }[] }[] = [];
  for (const e of events) {
    const at = wallClockOf(e.at, prefs.timezone);
    if (!at) continue;
    const text = describeEvent({ action: e.action, details: e.details });
    const last = days[days.length - 1];
    if (last && last.day === at.day) last.lines.push({ seq: e.seq, time: at.time, text });
    else days.push({ day: at.day, lines: [{ seq: e.seq, time: at.time, text }] });
  }

  return (
    <section className="section" aria-labelledby="history-heading">
      <div className="section__head">
        <h2 id="history-heading">History</h2>
        <p className="hint">
          Every change to the promise, the garments, what the order waits for and its pictures.
        </p>
      </div>
      {days.length === 0 ? (
        <div className="card">
          <p>Nothing has happened to this order yet.</p>
        </div>
      ) : (
        days.map((d) => (
          <div key={d.day} className="card">
            <h3>{formatDayLong(d.day)}</h3>
            <ul className="timeline">
              {d.lines.map((l) => (
                <li key={l.seq}>
                  <time>{l.time}</time>
                  <span>{l.text}</span>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}
