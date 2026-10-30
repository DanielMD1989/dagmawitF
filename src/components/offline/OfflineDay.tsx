'use client';

import { useState, useSyncExternalStore } from 'react';
import { formatDayLong, wallClockOf } from '@/domain/dates';
import {
  addTap,
  isForToday,
  returnPath,
  undoTap,
  withWaiting,
  type DaySnapshot,
  type OfflineEntry,
  type WaitingTap,
} from '@/domain/steps/offline';
import { clock } from '@/domain/steps/words';
import { readSnapshot, readWaiting, saveWaiting, subscribeOffline } from '@/lib/offline-store';

/**
 * Today with no signal (docs/harden.md): the calendar as it was when she last opened it, with her waiting ticks
 * applied. Everything here comes from the phone; nothing is fetched.
 */

const noSnapshot = () => null;
const noWaiting = (): WaitingTap[] => [];
const online = () => navigator.onLine;
const assumeOffline = () => false;
// The page is kept once and opened for any address, so where she was going is read from the address bar.
const noEvents = () => () => undefined;
const fromAddress = () => returnPath(new URLSearchParams(window.location.search).get('from') ?? undefined);
const toToday = () => '/';

export function OfflineDay() {
  const from = useSyncExternalStore(noEvents, fromAddress, toToday);
  const snapshot = useSyncExternalStore(subscribeOffline, readSnapshot, noSnapshot);
  const waiting = useSyncExternalStore(subscribeOffline, readWaiting, noWaiting);
  const signal = useSyncExternalStore(subscribeOffline, online, assumeOffline);
  // Read once: whether the kept list is today's does not change while she looks at it, short of midnight.
  const [openedAt] = useState(() => new Date());

  if (!snapshot) {
    return (
      <>
        <div className="page-head">
          <p className="eyebrow">No signal</p>
          <h1>Nothing is kept on this phone yet</h1>
          <p className="lede">
            Open Today once with signal, and it will be here the next time there is none.
          </p>
        </div>
        <TryAgain from={from} signal={signal} />
      </>
    );
  }

  const today = isForToday(snapshot, openedAt);
  const madeAt = wallClockOf(snapshot.madeAt, snapshot.timezone);
  const view = withWaiting(snapshot, waiting);
  const mine = waiting.filter((t) => t.ownerId === snapshot.ownerId);
  const days = view.days.filter((d, i) => i === 0 || d.entries.length > 0);

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">{signal ? 'Kept on this phone' : 'No signal'}</p>
        <h1>
          {today ? 'Today' : formatDayLong(snapshot.day)}, as of {madeAt ? clock(madeAt.time) : 'earlier'}
        </h1>
        <p className="lede">
          {today
            ? 'This is your calendar as it was when you last opened it. What you tick here waits on this phone and is sent when the signal is back.'
            : `This is the calendar from ${formatDayLong(snapshot.day)}, the last time it was opened with signal. It is a reminder, so nothing can be ticked here.`}
        </p>
      </div>

      <TryAgain from={from} signal={signal} />

      {mine.length > 0 && (
        <p className="card" role="status">
          {mine.length} {mine.length === 1 ? 'tick waits' : 'ticks wait'} to be sent.
        </p>
      )}

      {view.overdue.length > 0 && (
        <section className="section" aria-labelledby="offline-overdue">
          <div className="section__head">
            <h2 id="offline-overdue" className="eyebrow">
              Not done yet
            </h2>
          </div>
          <ul className="items">
            {view.overdue.map((e) => (
              <Entry key={e.id} entry={e} snapshot={snapshot} waiting={waiting} canTap={today} late />
            ))}
          </ul>
        </section>
      )}

      {days.map((d) => (
        <section key={d.day} className="section day-list" aria-labelledby={`offline-${d.day}`}>
          <div className="day-list__head">
            <h2 id={`offline-${d.day}`} className="h3">
              {d.heading}
            </h2>
          </div>
          {d.entries.length > 0 ? (
            <ul className="items">
              {d.entries.map((e) => (
                <Entry key={e.id} entry={e} snapshot={snapshot} waiting={waiting} canTap={today} />
              ))}
            </ul>
          ) : (
            <p className="day-list__empty">Nothing on that day.</p>
          )}
        </section>
      ))}
    </>
  );
}

function TryAgain({ from, signal }: { from: string; signal: boolean }) {
  return (
    <div className={signal ? 'card' : 'btn-row'} role={signal ? 'status' : undefined}>
      {signal && <p>The signal is back.</p>}
      <div className="btn-row">
        {/* A plain link: a full page load, so the app opens fresh and sends what waits. */}
        <a href={from} className={signal ? 'btn' : 'btn btn--quiet'}>
          {signal ? 'Open the app' : 'Try again'}
        </a>
      </div>
    </div>
  );
}

function Entry({
  entry,
  snapshot,
  waiting,
  canTap,
  late = false,
}: {
  entry: OfflineEntry;
  snapshot: DaySnapshot;
  waiting: WaitingTap[];
  canTap: boolean;
  late?: boolean;
}) {
  const tap = () => saveWaiting(addTap(waiting, entry, snapshot.ownerId, crypto.randomUUID(), new Date()));
  return (
    <li className={late ? 'item item--late' : 'item'}>
      <div className="item__head">
        {canTap ? (
          <div className="tick-form">
            <button
              type="button"
              className={entry.done ? 'tick tick--done' : 'tick'}
              aria-label={
                entry.done ? `${entry.title}: done. Mark as not done` : `Mark ${entry.title} as done`
              }
              onClick={tap}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
            </button>
          </div>
        ) : (
          <span className={entry.done ? 'item__mark item__mark--done' : 'item__mark'} aria-hidden="true" />
        )}
        <div className="item__main">
          {entry.time && <span className="item__time">{entry.time}</span>}
          <span className={entry.done ? 'item__title today__done' : 'item__title'}>{entry.title}</span>
          <span className="hint">
            {[entry.part, entry.jobLabel ?? 'Your own'].filter(Boolean).join(' · ')}
          </span>
          {entry.clash && (
            <span className="item__note item__note--warn">
              Its time crosses another step’s. Move one of them.
            </span>
          )}
          {entry.waiting > 0 && <span className="item__note">Waiting to be sent.</span>}
        </div>
      </div>
      {canTap && entry.undoKey && (
        <div className="today__actions">
          <button
            type="button"
            className="btn btn--quiet btn--small"
            aria-label={`Undo the last change to ${entry.title}`}
            onClick={() => saveWaiting(undoTap(waiting, entry.undoKey!))}
          >
            Undo
          </button>
        </div>
      )}
    </li>
  );
}
