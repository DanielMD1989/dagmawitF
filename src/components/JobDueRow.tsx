import Link from 'next/link';
import { dueWord, jobHeadline, type JobName } from '@/domain/jobs/words';

/**
 * One job by its own day: the work, "Delivery Sat 14 Nov" or "Event Sat 14 Nov", and how far off it is. Used on the
 * Coming up page and, for a job due today with no step today, on Today (decision 0078).
 */
export function JobDueRow({ job, day, left }: { job: JobName & { id: string }; day: string; left: string }) {
  const near = left === 'today' || left === 'tomorrow';
  return (
    <li>
      <Link href={`/orders/${job.id}`} className="row-link row-link--icon">
        <span className="row-icon" aria-hidden="true">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {job.clientName ? (
              <path d="M12 6a2 2 0 1 0-2-2 M12 6v2 M12 8 3 15h18z M3 15v2h18v-2" />
            ) : (
              <path d="M4 5h16v15H4z M4 10h16 M8 3v4 M16 3v4" />
            )}
          </svg>
        </span>
        <span className="row-link__title">{jobHeadline(job)}</span>
        <span className="hint">
          {dueWord(job)} {day}
        </span>
        <span className="row-link__side">
          <span className={near ? 'chip chip--sand' : 'chip chip--line'}>{left}</span>
        </span>
      </Link>
    </li>
  );
}
