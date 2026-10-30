'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { replayReport, type ReplayOutcome, type WaitingTap } from '@/domain/steps/offline';
import { readWaiting, saveWaiting } from '@/lib/offline-store';

type Sent = ReplayOutcome | 'keep';

/** Sends one waiting tick. 'keep' when it could not be sent now (no signal, signed out, the server failed). */
async function send(tap: WaitingTap): Promise<Sent> {
  let response: Response;
  try {
    response = await fetch('/api/steps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stepId: tap.stepId, sawDone: tap.sawDone, done: tap.done }),
    });
  } catch {
    return 'keep';
  }
  if (response.status !== 200 && response.status !== 400) return 'keep';
  let body: { result?: unknown; message?: unknown };
  try {
    body = await response.json();
  } catch {
    return 'keep';
  }
  if (body.result === 'applied') return { result: 'applied' };
  if (
    (body.result === 'stale' || body.result === 'missing' || body.result === 'invalid') &&
    typeof body.message === 'string'
  ) {
    return { result: body.result, message: `${tap.title}. ${body.message}` };
  }
  return 'keep';
}

/** Sends her waiting taps in order, one by one; stops at the first that cannot be sent now and keeps the rest. */
async function sendAll(ownerId: string): Promise<ReplayOutcome[]> {
  const outcomes: ReplayOutcome[] = [];
  for (;;) {
    const tap = readWaiting().find((t) => t.ownerId === ownerId);
    if (!tap) break;
    const sent = await send(tap);
    if (sent === 'keep') break;
    outcomes.push(sent);
    saveWaiting(readWaiting().filter((t) => t.key !== tap.key));
  }
  return outcomes;
}

/**
 * Sends the ticks made without signal (docs/harden.md, "The taps that wait") when a page of the app opens with
 * signal, and when the signal comes back while it is open, then says what was saved and what was left.
 */
export function OfflineSync({ ownerId }: { ownerId: string }) {
  const router = useRouter();
  const busy = useRef(false);
  const [report, setReport] = useState<ReturnType<typeof replayReport> | null>(null);

  const run = useCallback(async () => {
    if (busy.current || readWaiting().every((t) => t.ownerId !== ownerId)) return;
    busy.current = true;
    try {
      // One sender at a time, even with the app open in two tabs.
      const outcomes = navigator.locks
        ? await navigator.locks.request('dagmawit-waiting', () => sendAll(ownerId))
        : await sendAll(ownerId);
      if (outcomes.length > 0) {
        setReport(replayReport(outcomes));
        router.refresh();
      }
    } finally {
      busy.current = false;
    }
  }, [ownerId, router]);

  useEffect(() => {
    void run();
    window.addEventListener('online', run);
    return () => window.removeEventListener('online', run);
  }, [run]);

  if (!report) return null;
  return (
    <div className="card sync" role="status">
      {report.saved && <p>{report.saved}</p>}
      {report.left.length > 0 && (
        <>
          <p className="attention">
            {report.left.length === 1 ? 'One was not saved:' : `${report.left.length} were not saved:`}
          </p>
          <ul className="plain-list">
            {report.left.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </>
      )}
      <div className="btn-row">
        <button type="button" className="btn btn--quiet btn--small" onClick={() => setReport(null)}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
