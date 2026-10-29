import { STATUS_LABEL, type OrderStatus } from '@/domain/orders/status';

const TONE: Readonly<Record<OrderStatus, string>> = {
  draft: 'chip chip--line',
  active: 'chip',
  on_hold: 'chip chip--sand',
  delivered: 'chip chip--muted',
  cancelled: 'chip chip--warn',
};

/** An order's status in words. The word is always there, so the colour never carries the meaning alone. */
export function StatusChip({ status }: { status: OrderStatus }) {
  return <span className={TONE[status]}>{STATUS_LABEL[status]}</span>;
}
