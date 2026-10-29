# Change: seeing what a change does before agreeing to it

Stage 5. The agreed contract for the impact of a change, moving a task, and the Planner's week board. Plans are in
[planning.md](planning.md), My Day in [my-day.md](my-day.md). The reasons are in decisions 0046 to 0050. If code and
this page disagree, one of them is a bug.

## The idea in one paragraph

When something changes (the lace will come on Friday instead of Wednesday, a fitting moves, she wants the bodice done
on Thursday), she saves it with **Save and see impact**. That saves the fact, plans again, and opens the proposal at
**What moves**: each task whose days change, from when to when, and each order whose ready day or state changes.
Nothing she works from changes until she **approves**. The **Planner** shows the approved plan as a week board.

## Save and see impact

Offered where a planning fact is edited for an order that is active:

- a preparation item (its state, its expected day, whether it holds work back);
- a task (its estimate, its day and time, the day it may not start before, the day it is pinned to).

It is the same save, then the same proposal as "Make a proposal" (`proposeNow`, `src/server/propose.ts`, the one place
a proposal is made), then the review of that proposal for that order. If the engine refuses, the change stays saved
and she reads why, next to the form.

## What moves

`taskMoves(approved, proposed)` (`src/domain/planning/review.ts`) uses the engine's `diff`:

| Change              | Reads                                                |
| ------------------- | ---------------------------------------------------- |
| `moved`             | "Apply the lace: Mon 16 Nov → Thu 19 Nov"            |
| `newly_planned`     | "Second fitting: now planned Mon 16 Nov"             |
| `no_longer_planned` | "Apply the lace: no longer planned (was Mon 16 Nov)" |

The review lists this order's moves first, then the number of other orders' tasks that move, each order named with
its own moves folded under it. "What changes" (Stage 3: ready days and states) stays above it.

## Moving a task

- **An appointment** moves by its day and time (Stage 3).
- **A piece of work** can be **pinned to a day**: `task.pinned_on`. The engine is given a locked slot of all its
  remaining minutes on that day (engine.md, "Pinned things"): it stays there and the rest is planned around it. A day
  that cannot hold it all is reported (`pinned_over_capacity`), never silently split.
- **Not before** a day still says "no earlier than", for when the start is decided by something else.
- A pin is for its day. Once the day has passed and the task is not done, it is planned like any other task
  (decision 0048): a pin in the past can no longer be kept, and the review shows where it goes now.

Pinning is a change of plan: it raises `plan_epoch` like any other.

## The Planner's week board

`/planner` shows the approved plan a week at a time (`?week=` any day of it; this week by default):

- each day: its date, the minutes planned against her usable minutes, and its tasks in the plan's order, with the
  order, the minutes that day and an appointment's time, each linked to the task on its order's Plan tab;
- a closed day says so;
- the week's total against her usable time;
- the approved plan's number, and the same "out of date" notice as My Day.

`weekBoard(stored, slots, week)` (`src/domain/planning/week.ts`) makes it from the plan alone, so the board shows
exactly what she approved.

## Navigation

The phone's bar holds five places: My Day, Orders, Planner, Library, Settings. Clients stays in the desktop sidebar and
is reached on a phone from the Orders page (decision 0047).

## How it is tested

1. **Domain**: `taskMoves` for each kind of change, `weekBoard` (days, totals, closed days, order within a day), pins in
   the plan input (kept from today on, dropped once passed).
2. **Database**: `pinned_on` only on work, raising the plan epoch, frozen with a closed order.
3. **Browser**: the lace delay by hand: change the lace's expected day with Save and see impact, read what moves,
   approve, and see My Day and the Planner follow; a task pinned to a day; the week board.

## Exit test (manual)

The lace delay scenario works by hand on her real data.
