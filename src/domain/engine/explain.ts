import { formatDay, type IsoDate } from '../dates';
import { formatMinutes } from '../duration';

/**
 * Step 6 of the engine: the words. Every finding is also a typed code with its numbers, so a
 * screen may phrase it differently. This file is the one place the English lives, which is
 * what makes it simple to translate later.
 */

const day = (iso: IsoDate) => formatDay(iso);
const days = (n: number) => `${n} day${n === 1 ? '' : 's'}`;
const workingDays = (n: number) => `${n} working day${n === 1 ? '' : 's'}`;

export const say = {
  orderCannotMakeDelivery(p: {
    label: string;
    deliveryOn: IsoDate;
    earliest: IsoDate | null;
    lateWorkingDays: number | null;
    limitedBy: string;
    workMinutes: number;
    availableMinutes: number;
  }): string {
    const when = p.earliest
      ? `the soonest it could be ready is ${day(p.earliest)}${p.lateWorkingDays ? `, ${workingDays(p.lateWorkingDays)} too late` : ''}`
      : 'it cannot be ready before the end of the planning calendar';
    const why =
      p.workMinutes > p.availableMinutes
        ? `It needs ${formatMinutes(p.workMinutes)} of work and she has only ${formatMinutes(p.availableMinutes)} of planned time before handover.`
        : `Held up by "${p.limitedBy}".`;
    return `${p.label} cannot be ready for handover on ${day(p.deliveryOn)}. Even with every hour of hers, ${when}. ${why}`;
  },

  // `complete` is false when part of the order is not in the plan. Then there is no day on which
  // it is ready, only a day on which the planned work ends, and the words say exactly that.
  orderLate(p: {
    label: string;
    finish: IsoDate;
    complete: boolean;
    deliveryOn: IsoDate;
    lateDays: number;
  }): string {
    const subject = p.complete
      ? `${p.label} would be ready on ${day(p.finish)}`
      : `The work planned for ${p.label} ends on ${day(p.finish)}`;
    return `${subject}, after handover on ${day(p.deliveryOn)} (${days(p.lateDays)} late).`;
  },

  bufferUsed(p: {
    label: string;
    finish: IsoDate;
    complete: boolean;
    bufferDays: number;
    intoBuffer: number;
  }): string {
    const subject = p.complete
      ? `${p.label} is ready on ${day(p.finish)}`
      : `The work planned for ${p.label} ends on ${day(p.finish)}`;
    return `${subject}, which uses ${days(p.intoBuffer)} of its ${days(p.bufferDays)} buffer before handover.`;
  },

  capacityShared(p: { label: string; earliest: IsoDate; finish: IsoDate; complete: boolean }): string {
    const result = p.complete
      ? `the plan has it ready on ${day(p.finish)}`
      : `the work planned for it ends on ${day(p.finish)}`;
    return `On its own, ${p.label} could be ready by ${day(p.earliest)}. Her time is shared with other work, so ${result}.`;
  },

  taskAfterLatestFinish(p: {
    title: string;
    finish: IsoDate;
    latest: IsoDate;
    lateDays: number;
    waitingFor: string | null;
    expectedOn: IsoDate | null;
  }): string {
    const waiting =
      p.waitingFor && p.expectedOn
        ? ` It cannot start before ${p.waitingFor} arrives (expected ${day(p.expectedOn)}).`
        : '';
    return `"${p.title}" finishes on ${day(p.finish)}, but must finish by ${day(p.latest)} to keep the promise (${days(p.lateDays)} late).${waiting}`;
  },

  fixedBeforePredecessor(p: {
    title: string;
    pinnedDay: IsoDate;
    predecessor: string;
    predecessorFinish: IsoDate;
    lagDays: number;
    okFrom: IsoDate;
    minutesToFree: number;
  }): string {
    const lag = p.lagDays > 0 ? ` and then needs ${days(p.lagDays)}` : '';
    const free =
      p.minutesToFree > 0 ? `, or take ${formatMinutes(p.minutesToFree)} out of "${p.predecessor}"` : '';
    return `"${p.title}" is set for ${day(p.pinnedDay)}, but "${p.predecessor}" finishes on ${day(p.predecessorFinish)}${lag}. Move "${p.title}" to ${day(p.okFrom)} or later${free}.`;
  },

  fixedBeforePrerequisite(p: {
    title: string;
    pinnedDay: IsoDate;
    waitingFor: string;
    expectedOn: IsoDate;
  }): string {
    return `"${p.title}" is set for ${day(p.pinnedDay)}, but it needs ${p.waitingFor}, which is expected on ${day(p.expectedOn)}. Move "${p.title}" to ${day(p.expectedOn)} or later, or get ${p.waitingFor} sooner.`;
  },

  pinnedPrerequisiteUndated(p: { title: string; pinnedDay: IsoDate; waitingFor: string }): string {
    return `"${p.title}" is set for ${day(p.pinnedDay)}, but it needs ${p.waitingFor}, which has no expected date. Add a date to see whether it will be there in time.`;
  },

  pinnedPredecessorUnplanned(p: { title: string; pinnedDay: IsoDate; predecessor: string }): string {
    return `"${p.title}" is set for ${day(p.pinnedDay)}, but "${p.predecessor}", which it follows, is not in the plan.`;
  },

  fixedUndated(p: { title: string }): string {
    return `"${p.title}" has no day yet, so it and the work after it are not in the plan. Set its day and time to plan them.`;
  },

  taskOnHold(p: { title: string; reason: string }): string {
    return p.reason
      ? `"${p.title}" is on hold (${p.reason}), so it is not in the plan.`
      : `"${p.title}" is on hold, so it is not in the plan.`;
  },

  prerequisiteUndated(p: { title: string; waitingFor: string }): string {
    return `"${p.title}" is waiting for ${p.waitingFor}, which has no expected date, so it is not in the plan. Add a date to plan it.`;
  },

  predecessorUnplanned(p: { title: string; predecessor: string }): string {
    return `"${p.title}" follows "${p.predecessor}", which is not in the plan, so it is not planned either.`;
  },

  noRoomInCalendar(p: { title: string; detail: string }): string {
    return `"${p.title}" does not fit in the planning calendar (${p.detail}).`;
  },

  pinnedOnClosedDay(p: { title: string; day: IsoDate }): string {
    return `"${p.title}" is set for ${day(p.day)}, a day marked closed. It stays where you put it.`;
  },

  pinnedOverCapacity(p: { day: IsoDate; pinned: number; usable: number }): string {
    return `${day(p.day)} already has ${formatMinutes(p.pinned)} set by hand, more than the ${formatMinutes(p.usable)} planned for that day. Nothing else is added to it.`;
  },
};
