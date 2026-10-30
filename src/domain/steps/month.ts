import { addDays, isIsoDate, isoWeekday, type IsoDate } from '../dates';

/** The weeks of a month as her calendar shows them: Monday first, with the days of the months around it. */

export interface MonthGrid {
  /** 'YYYY-MM' */
  month: string;
  /** "November 2026" */
  title: string;
  first: IsoDate;
  last: IsoDate;
  /** The first and last day shown, from the Monday before `first` to the Sunday after `last`. */
  from: IsoDate;
  to: IsoDate;
  previous: string;
  next: string;
  days: { day: IsoDate; inMonth: boolean }[];
}

const MONTH = /^(\d{4})-(\d{2})$/;

/** The month named, or the month of `today` when the name is missing or not a month. */
export function monthGrid(name: string | undefined, today: IsoDate): MonthGrid {
  const m = MONTH.exec(name ?? '');
  const month =
    m && Number(m[2]) >= 1 && Number(m[2]) <= 12 && Number(m[1]) >= 2000 && Number(m[1]) <= 2099
      ? `${m[1]}-${m[2]}`
      : today.slice(0, 7);
  const first = `${month}-01`;
  let last = addDays(first, 27);
  while (isIsoDate(addDays(last, 1)) && addDays(last, 1).startsWith(month)) last = addDays(last, 1);
  const from = addDays(first, 1 - isoWeekday(first));
  const to = addDays(last, 7 - isoWeekday(last));
  const days: MonthGrid['days'] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push({ day: d, inMonth: d.startsWith(month) });
  const title = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(
    new Date(`${first}T00:00:00Z`),
  );
  return {
    month,
    title,
    first,
    last,
    from,
    to,
    previous: addDays(first, -1).slice(0, 7),
    next: addDays(last, 1).slice(0, 7),
    days,
  };
}
