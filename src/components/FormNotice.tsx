'use client';

import { useEffect, useRef } from 'react';
import type { ActionState } from '@/lib/action-state';

/**
 * Takes her to what was refused (decision 0100): the first field marked wrong, opened out of any fold it sits in and
 * focused, or, with no field to point at, the message itself, brought into view. A refusal she has to scroll to find
 * is one she misses.
 */
function showRefusal(marker: HTMLElement, notice: HTMLElement | null): void {
  const form = marker.closest('form');
  const field = form?.querySelector<HTMLElement>('[aria-invalid="true"]');
  if (field) {
    for (let fold = field.closest('details'); fold; fold = fold.parentElement?.closest('details') ?? null)
      fold.open = true;
    field.focus({ preventScroll: true });
    field.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return;
  }
  (notice ?? form)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

/** The result line under a form. Announced to screen readers; errors interrupt, successes do not. */
export function FormNotice({ state }: { state: ActionState }) {
  const marker = useRef<HTMLSpanElement>(null);
  const notice = useRef<HTMLParagraphElement>(null);

  // Each refusal is a new state object, so a second refusal of the same field takes her there again.
  useEffect(() => {
    if (state.status === 'error' && marker.current) showRefusal(marker.current, notice.current);
  }, [state]);

  const isError = state.status === 'error';
  return (
    <>
      {isError && <span ref={marker} hidden />}
      {state.status !== 'idle' && state.message && (
        <p ref={notice} className={`notice notice--${state.status}`} role={isError ? 'alert' : 'status'}>
          {state.message}
        </p>
      )}
    </>
  );
}
