import type { IsoDate } from '@/domain/dates';
import { DeliveredForm } from './DeliveredForm';

/**
 * "Delivered…", under "Next: Delivery" once an order's Delivery is all that is left (decision 0097). It opens to ask
 * the day it was handed over, today unless she says otherwise (decision 0101), and finishes the order on that day,
 * ahead of its day if she delivered early.
 */
export function DeliverNowButton({
  orderId,
  today,
  whose,
}: {
  orderId: string;
  today: IsoDate;
  /** "Tiest · Fetil outfit", said to a screen reader. */
  whose: string;
}) {
  return (
    <details className="disclosure disclosure--main deliver-now">
      <summary aria-label={`Delivered: ${whose}`}>Delivered…</summary>
      <div className="disclosure__panel">
        <DeliveredForm orderId={orderId} today={today} idPrefix={`now-${orderId}`} />
      </div>
    </details>
  );
}
