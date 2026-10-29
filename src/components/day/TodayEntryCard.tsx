import Link from 'next/link';
import type { TodayEntry, TodayState } from '@/domain/day/today';
import { formatMinutes } from '@/domain/duration';
import {
  DoneForm,
  HoldForm,
  ReleaseButton,
  ReopenButton,
  StartButton,
  StillGoingForm,
} from './ProgressForms';

const CHIP: Record<TodayState, { text: string; className: string }> = {
  ready: { text: 'Ready', className: 'chip chip--line' },
  started: { text: 'Started', className: 'chip chip--sand' },
  done: { text: 'Done', className: 'chip' },
  blocked: { text: 'Blocked', className: 'chip chip--warn' },
  held: { text: 'On hold', className: 'chip chip--warn' },
};

/** One task of the day, with what she can do about it. */
export function TodayEntryCard({ entry, today }: { entry: TodayEntry; today: string }) {
  const { task } = entry;
  const ownTime = task.kind === 'work' || task.kind === 'fixed';
  const length = entry.minutesToday > 0 ? formatMinutes(entry.minutesToday) : null;
  return (
    <li className={entry.state === 'blocked' || entry.state === 'held' ? 'item item--undated' : 'item'}>
      <div className="item__head">
        {entry.time && <span className="today__time">{entry.time}</span>}
        <div className="item__main">
          <span className={entry.state === 'done' ? 'item__title today__done' : 'item__title'}>
            {task.title}
          </span>
          <span className="hint">
            {task.orderLabel ?? 'Studio work'}
            {length && ` · ${length}`}
            {!entry.counted && length && ', not counted today'}
            {entry.state === 'done' &&
              task.actualMinutes !== null &&
              ` · took ${formatMinutes(task.actualMinutes)}`}
            {entry.state === 'started' &&
              task.remainingMinutes !== null &&
              ` · about ${formatMinutes(task.remainingMinutes)} left`}
          </span>
          {entry.reason && <span className="item__note">{entry.reason}</span>}
        </div>
        <span className={CHIP[entry.state].className}>{CHIP[entry.state].text}</span>
      </div>
      <div className="today__actions">
        {entry.state === 'ready' && <StartButton id={task.id} title={task.title} />}
        {entry.state === 'held' && <ReleaseButton id={task.id} title={task.title} />}
        {entry.state === 'done' && <ReopenButton id={task.id} title={task.title} />}
        {entry.state === 'blocked' && task.orderId && (
          <Link href={`/orders/${task.orderId}/preparation`} className="btn btn--quiet btn--small">
            Update expected date
          </Link>
        )}
      </div>
      {(entry.state === 'ready' || entry.state === 'started') && (
        <div className="today__forms">
          <DoneForm
            id={task.id}
            title={task.title}
            status={task.status}
            needsTime={ownTime}
            suggested={task.minutes}
            today={today}
          />
          {ownTime && (
            <StillGoingForm
              id={task.id}
              title={task.title}
              status={task.status}
              left={task.remainingMinutes}
            />
          )}
          <HoldForm id={task.id} title={task.title} />
        </div>
      )}
    </li>
  );
}
