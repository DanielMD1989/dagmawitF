# My Day: living the approved plan

Stage 4. The agreed contract for today's list, recording progress, quick-added work and the end-of-day review. Plans are
in [planning.md](planning.md); the engine in [engine.md](engine.md). The reasons are in decisions 0040 to 0045. If code
and this page disagree, one of them is a bug.

## The idea in one paragraph

My Day shows **today's slots of the approved plan**: appointments at their time, then the work in the order the plan
suggests. She **starts** a task, marks it **done** with the time it really took, or **holds** it with a reason. A task
whose material has not arrived shows as **blocked**, worked out, never stored. **Quick Add** takes work that came in
the door. At the end of the day the **review** asks, for each task of the day not done, whether it is done or how long
is left, and then makes tomorrow's proposal.

## Progress on a task

New columns on `task`:

| Column              | Meaning                                                                                |
| ------------------- | -------------------------------------------------------------------------------------- |
| `status`            | `not_started`, `in_progress` or `done`.                                                |
| `started_at`        | When it was first started. Set by the database.                                        |
| `done_on`           | The day it was finished. Only when done; never after her today.                        |
| `actual_minutes`    | The time it really took, in total. Only when done; required for work and appointments. |
| `remaining_minutes` | Her estimate of what is left. Only while in progress.                                  |
| `hold_reason`       | Not empty when she has put it on hold. A held task is not planned.                     |

- Moves: any status to any other. Leaving `done` clears `done_on` and `actual_minutes`; leaving `in_progress` clears
  `remaining_minutes`. The database does this, so no screen can leave a half-state.
- `minutes` stays her estimate. The actual time is kept beside it, so the library can later learn from the difference.
- A waiting period or a milestone is done with no minutes.

What the engine is given (`buildPlanInput`):

| Stored                                        | Engine                                            |
| --------------------------------------------- | ------------------------------------------------- |
| `done`, `done_on`                             | `status: 'done'`, `doneOn`                        |
| `in_progress`, `remaining_minutes ?? minutes` | `status: 'in_progress'`, `minutes` = what is left |
| `hold_reason` not empty                       | `hold`                                            |

A done task is pinned in the past and cuts its chain (engine.md). A fitting that happened is marked done, which is how
a fitting whose day has passed stops blocking proposals (Stage 3's known limit).

## Two counters

- `plan_epoch` (Stage 3) rises when the **shape** of the plan changes: estimates, links, days, holds, preparation,
  orders, her calendar. The approved plan is "out of date" when it differs.
- `progress_epoch` (new) rises when **progress** is recorded: start, done, what is left, undone. Recording progress is
  living the plan, not changing it, so it does not make the approved plan out of date (decision 0040).

A proposal keeps both. `approve_plan` refuses one made before progress was recorded since ("work was marked since
this proposal was made"), because it would plan again work that is done.

## Studio work (Quick Add)

A task may have no order: studio work, such as a walk-in hem or sharpening the shears. `order_id` and `order_item_id`
are both empty or both set. The engine plans studio work after every order (it has no promise). Quick Add takes a
title, how long, and optionally an order (the task then belongs to that order's first garment). Quick-added work waits
for the next proposal for a day; until then My Day lists it as "waiting for a day".

## Today's list

`buildToday` (`src/domain/day/today.ts`), from the approved plan's slots for today and the live tasks:

- Each slot of today, in rank order: the task, its order, the minutes planned today, its clock time if an appointment.
- Its state: **Done**, **Started**, **On hold**, **Blocked** (it waits for a blocking preparation item that has not
  arrived; the reason names it and its expected day), or **Ready**.
- Blocked and held tasks are not counted in today's planned time ("not counted today").
- Tasks in progress that the plan does not put on today are listed under "Also started".
- The header: minutes planned today against her usable minutes today, and what is left free.

With no approved plan, or one that has no slots today, the page says so and points to making one. When the approved
plan is out of date it says so, and today's list is still shown: it is what she agreed to.

## End-of-day review

`/today/review` lists today's tasks that are not done, and every task in progress. For each: **Done** (with the time it
took), **Still going** (with about how long is left), or leave it. Then **Make tomorrow's proposal** opens the review of
a new plan (planning.md). Nothing here moves until she approves.

## History

Two new events on the order: `task_done` (title, actual and estimated minutes, day) and `task_hold` (title, reason, or
released). Studio work has no order and no history.

## Screens

| Route           | Shows                                                                             |
| --------------- | --------------------------------------------------------------------------------- |
| `/`             | My Day: today's time, today's list with its actions, Quick Add, quick-added work. |
| `/today/review` | The end-of-day review.                                                            |
| Plan tab        | Each task's progress and, when done, its actual time beside the estimate.         |

## How it is tested

1. **Domain**: the plan input with progress, `buildToday` (states, blocked reasons, what is counted), the progress forms.
2. **Database**: the status columns' rules and clearing, done never after today, studio work, the two counters rising
   for exactly their facts, approval refused after progress, history, owner isolation.
3. **Browser**: a day lived: start, done with actual time, hold and release, a blocked task, quick add, the end-of-day
   review and tomorrow's proposal approved.

## Exit test (manual)

She runs her working days from My Day for a week. Count how often she went back to the notebook, and why.
