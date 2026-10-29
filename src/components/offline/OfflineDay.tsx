'use client';

import { useState, useSyncExternalStore, type FormEvent } from 'react';
import { formatDayLong, wallClockOf } from '@/domain/dates';
import { parseDone, parseRemaining } from '@/domain/day/forms';
import {
  addTap,
  isForToday,
  returnPath,
  offlineTaps,
  undoTap,
  withWaiting,
  type DaySnapshot,
  type OfflineChange,
  type OfflineEntry,
  type Section,
  type WaitingTap,
} from '@/domain/day/offline';
import { takesHerTime } from '@/domain/day/progress';
import type { TodayState } from '@/domain/day/today';
import { formatMinutes } from '@/domain/duration';
import { estimateFields } from '@/domain/planning/forms';
import { HoursMinutes } from '@/components/HoursMinutes';
import { readSnapshot, readWaiting, saveWaiting, subscribeOffline } from '@/lib/offline-store';

/**
 * My Day with no signal (docs/harden.md): the day as it was when she last opened it, with her waiting taps applied.
 * Everything here comes from the phone; nothing is fetched.
 */

const CHIP: Record<TodayState, { text: string; className: string }> = {
  ready: { text: 'Ready', className: 'chip chip--line' },
  started: { text: 'Started', className: 'chip chip--sand' },
  done: { text: 'Done', className: 'chip' },
  blocked: { text: 'Blocked', className: 'chip chip--warn' },
  held: { text: 'On hold', className: 'chip chip--warn' },
};

const SECTIONS: { section: Section; heading: string }[] = [
  { section: 'fixed', heading: 'Fixed' },
  { section: 'work', heading: 'Planned, in suggested order' },
  { section: 'started', heading: 'Also started' },
];

const noSnapshot = () => null;
const noWaiting = (): WaitingTap[] => [];
const online = () => navigator.onLine;
const assumeOffline = () => false;
// The page is kept once and opened for any address, so where she was going is read from the address bar.
const noEvents = () => () => undefined;
const fromAddress = () => returnPath(new URLSearchParams(window.location.search).get('from') ?? undefined);
const toMyDay = () => '/';

export function OfflineDay() {
  const from = useSyncExternalStore(noEvents, fromAddress, toMyDay);
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
            Open My Day once with signal, and it will be here the next time there is none.
          </p>
        </div>
        <TryAgain from={from} signal={signal} />
      </>
    );
  }

  const today = isForToday(snapshot, openedAt);
  const madeAt = wallClockOf(snapshot.madeAt, snapshot.timezone);
  const entries = withWaiting(snapshot, waiting);
  const mine = waiting.filter((t) => t.ownerId === snapshot.ownerId);

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">{signal ? 'Kept on this phone' : 'No signal'}</p>
        <h1>
          {today ? 'Today' : formatDayLong(snapshot.day)}, as of {madeAt?.time ?? 'earlier'}
        </h1>
        <p className="lede">
          {today
            ? 'This is My Day as it was when you last opened it. What you mark here waits on this phone and is sent when the signal is back.'
            : `This is the list from ${formatDayLong(snapshot.day)}, the last time My Day was opened with signal. It is a reminder, not today’s plan, so nothing can be marked here.`}
        </p>
      </div>

      <TryAgain from={from} signal={signal} />

      {mine.length > 0 && (
        <p className="card" role="status">
          {mine.length} {mine.length === 1 ? 'change waits' : 'changes wait'} to be sent.
        </p>
      )}

      <section className="card" aria-label="Time that day">
        <div className="big-number">
          {formatMinutes(snapshot.plannedMinutes)} planned{' '}
          <small>of {formatMinutes(snapshot.usableMinutes)} usable</small>
        </div>
        {snapshot.planNumber !== null && <p className="hint">From plan {snapshot.planNumber}.</p>}
      </section>

      {entries.length === 0 && (
        <div className="card">
          <p>Nothing was planned for that day.</p>
        </div>
      )}

      {SECTIONS.map(({ section, heading }) => {
        const list = entries.filter((e) => e.section === section);
        if (list.length === 0) return null;
        return (
          <section key={section} className="section" aria-labelledby={`offline-${section}`}>
            <div className="section__head">
              <h2 id={`offline-${section}`} className="eyebrow">
                {heading}
              </h2>
            </div>
            <ul className="items">
              {list.map((e) => (
                <Entry key={e.id} entry={e} snapshot={snapshot} waiting={waiting} canTap={today} />
              ))}
            </ul>
          </section>
        );
      })}
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
}: {
  entry: OfflineEntry;
  snapshot: DaySnapshot;
  waiting: WaitingTap[];
  canTap: boolean;
}) {
  const taps = canTap ? offlineTaps(entry) : [];
  const length = entry.minutesToday > 0 ? formatMinutes(entry.minutesToday) : null;
  const tap = (change: OfflineChange) => {
    const next = addTap(waiting, entry, snapshot.ownerId, change, crypto.randomUUID(), new Date());
    if (next) saveWaiting(next);
  };

  return (
    <li className={entry.state === 'blocked' || entry.state === 'held' ? 'item item--undated' : 'item'}>
      <div className="item__head">
        {entry.time && <span className="today__time">{entry.time}</span>}
        <div className="item__main">
          <span className={entry.state === 'done' ? 'item__title today__done' : 'item__title'}>
            {entry.title}
          </span>
          <span className="hint">
            {entry.orderLabel ?? 'Studio work'}
            {length && ` · ${length}`}
            {entry.state === 'done' &&
              entry.actualMinutes !== null &&
              ` · took ${formatMinutes(entry.actualMinutes)}`}
            {entry.state === 'started' &&
              entry.remainingMinutes !== null &&
              ` · about ${formatMinutes(entry.remainingMinutes)} left`}
          </span>
          {entry.reason && <span className="item__note">{entry.reason}</span>}
          {entry.waiting > 0 && <span className="item__note">Waiting to be sent.</span>}
        </div>
        <span className={CHIP[entry.state].className}>{CHIP[entry.state].text}</span>
      </div>
      {(taps.includes('start') || entry.undoKey) && (
        <div className="today__actions">
          {taps.includes('start') && (
            <button
              type="button"
              className="btn btn--quiet btn--small"
              aria-label={`Start ${entry.title}`}
              onClick={() => tap({ kind: 'start' })}
            >
              Start
            </button>
          )}
          {canTap && entry.undoKey && (
            <button
              type="button"
              className="btn btn--quiet btn--small"
              aria-label={`Undo the last change to ${entry.title}`}
              onClick={() => saveWaiting(undoTap(waiting, entry.undoKey!))}
            >
              Undo
            </button>
          )}
        </div>
      )}
      {(taps.includes('done') || taps.includes('remaining')) && (
        <div className="today__forms">
          {taps.includes('done') && <DoneForm entry={entry} day={snapshot.day} onTap={tap} />}
          {taps.includes('remaining') && <StillGoingForm entry={entry} onTap={tap} />}
        </div>
      )}
    </li>
  );
}

function DoneForm({
  entry,
  day,
  onTap,
}: {
  entry: OfflineEntry;
  day: string;
  onTap: (change: OfflineChange) => void;
}) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const needsTime = takesHerTime(entry.kind);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // The same reading as the form on My Day; the day is the list's day.
    const parsed = parseDone(new FormData(event.currentTarget), day, needsTime);
    if (!parsed.ok) return setErrors(parsed.errors);
    setErrors({});
    onTap({ kind: 'done', ...parsed.value });
  };
  return (
    <details className="disclosure disclosure--link">
      <summary>
        Done<span className="sr-only">: {entry.title}</span>
      </summary>
      <div className="disclosure__panel">
        <form className="form" noValidate onSubmit={submit}>
          {needsTime && (
            <HoursMinutes
              prefix="actual"
              id={entry.id}
              legend="How long it took, in total"
              error={errors['actual-hours']}
              {...estimateFields(entry.minutes)}
            />
          )}
          <div className="btn-row">
            <button type="submit" className="btn">
              Mark as done
            </button>
          </div>
        </form>
      </div>
    </details>
  );
}

function StillGoingForm({ entry, onTap }: { entry: OfflineEntry; onTap: (change: OfflineChange) => void }) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = parseRemaining(new FormData(event.currentTarget));
    if (!parsed.ok) return setErrors(parsed.errors);
    setErrors({});
    onTap({ kind: 'remaining', minutes: parsed.value });
  };
  return (
    <details className="disclosure disclosure--link">
      <summary>
        Still going<span className="sr-only">: {entry.title}</span>
      </summary>
      <div className="disclosure__panel">
        <form className="form" noValidate onSubmit={submit}>
          <HoursMinutes
            prefix="remaining"
            id={entry.id}
            legend="About how long is left"
            error={errors['remaining-hours']}
            {...estimateFields(entry.remainingMinutes)}
          />
          <div className="btn-row">
            <button type="submit" className="btn">
              Save what is left
            </button>
          </div>
        </form>
      </div>
    </details>
  );
}
