'use client';

import { useId, useState } from 'react';
import type { IsoDate } from '@/domain/dates';
import { DeliveredForm } from './DeliveredForm';

/**
 * The round mark beside an active order's Delivery step (decision 0101). Ticking it is handing the order over, so it
 * does not tick at once: it opens under the step to ask the day it was delivered, today unless she says otherwise.
 */
export function DeliveryTick({
  orderId,
  title,
  today,
}: {
  orderId: string;
  /** "Delivery, Tiest · Fetil outfit". */
  title: string;
  today: IsoDate;
}) {
  const [open, setOpen] = useState(false);
  const panel = useId();
  return (
    <>
      <div className="tick-form">
        <button
          type="button"
          className={open ? 'tick tick--asking' : 'tick'}
          aria-label={`Mark ${title} as delivered`}
          aria-expanded={open}
          aria-controls={panel}
          onClick={() => setOpen((o) => !o)}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
        </button>
      </div>
      {open && (
        <div id={panel} className="disclosure__panel deliver-panel">
          <DeliveredForm orderId={orderId} today={today} idPrefix={`tick-${orderId}`} />
        </div>
      )}
    </>
  );
}
