import { addDays, daysBetween, isoWeekday, type IsoDate } from '../dates';
import type { Slot, TaskKind } from '../engine/types';
import type { StoredPlan } from './proposal';

/** The Planner's week board (docs/change.md): the approved plan, a week at a time, Monday first. Pure. */

export interface BoardTask {
  taskId: string;
  orderId: string | null;
  orderLabel: string | null;
  title: string;
  kind: TaskKind;
  minutes: number;
  time: string | null;
}

export interface BoardDay {
  day: IsoDate;
  /** Her usable minutes that day, from the plan's calendar. Null outside it (before the plan's first day). */
  usable: number | null;
  planned: number;
  tasks: BoardTask[];
}

export interface WeekBoard {
  /** The Monday. */
  week: IsoDate;
  days: BoardDay[];
  planned: number;
  usable: number;
}

export const mondayOf = (day: IsoDate): IsoDate => addDays(day, 1 - isoWeekday(day));

export function weekBoard(stored: StoredPlan, slots: readonly Slot[], anyDayOfWeek: IsoDate): WeekBoard {
  const week = mondayOf(anyDayOfWeek);
  const facts = new Map(stored.facts.tasks.map((t) => [t.id, t]));
  const labels = new Map(stored.facts.orders.map((o) => [o.id, o.label]));
  const days: BoardDay[] = [];
  for (let i = 0; i < 7; i++) {
    const day = addDays(week, i);
    const index = daysBetween(stored.calendar.start, day);
    const usable =
      index >= 0 && index < stored.calendar.usable.length ? (stored.calendar.usable[index] ?? 0) : null;
    const tasks = slots
      .filter((s) => s.day === day)
      .sort((a, b) => a.rank - b.rank)
      .map((s) => {
        const f = facts.get(s.taskId);
        return {
          taskId: s.taskId,
          orderId: f?.orderId ?? null,
          orderLabel: f?.orderId ? (labels.get(f.orderId) ?? null) : null,
          title: f?.title ?? 'A task since removed',
          kind: f?.kind ?? 'work',
          minutes: s.minutes,
          time: s.time ?? null,
        };
      });
    days.push({ day, usable, planned: tasks.reduce((sum, t) => sum + t.minutes, 0), tasks });
  }
  return {
    week,
    days,
    planned: days.reduce((sum, d) => sum + d.planned, 0),
    usable: days.reduce((sum, d) => sum + (d.usable ?? 0), 0),
  };
}
