# The scheduling engine

The agreed contract for `src/domain/engine`. The design reasons are on the canvas (Engine board) and in
[decisions.md](decisions.md). The rules below are what the code and the tests hold to. If code and this page disagree,
one of them is a bug: fix the cause, never the test.

## The one rule

`plan(input)` is a pure function. Same input, same output, byte for byte. No clock, no randomness, no database, no
framework. "Today" is a value in the input. The order of the input lists does not matter.

```
plan(input) → { ok: true, plan } | { ok: false, errors }
diff(planA, planB) → what moved, which orders got worse, how the ready dates changed
```

Try it without any screen: `npm run plan` lists the sample situations, `npm run plan -- bridal-gown` prints one as she
would read it, and `npm run plan -- bridal-gown bridal-gown-lace-late` prints what changed when the lace came late.

## What goes in

| Input           | What it holds                                                                                        |
| --------------- | ---------------------------------------------------------------------------------------------------- |
| `today`         | The first day anything may be planned on.                                                            |
| `calendar`      | `start` and `usable[]`: minutes the planner may fill on each day, from her week, days off and ratio. |
| `tasks`         | `kind`, `minutes` or `days`, `status`, `notBefore`, `fixedAt`, `deadline`, `lockedSlots`, `hold` ... |
| `edges`         | Predecessor to successor, with `lagDays` (calendar days of rest between them).                       |
| `orders`        | `deliveryOn` (the promised handover day) and `bufferDays` (days kept free before it).                |
| `prerequisites` | Fabric, lace, approvals: `state`, `expectedOn`, `blocking`. `requirements` link them to tasks.       |

Dates are `YYYY-MM-DD` text. Inside, days are whole numbers counted from `calendar.start`. `buildCalendar` makes the
`calendar` from her saved working week, days off and planning ratio, using the same rules My Day uses.

## Four kinds of task

| Kind        | Uses her minutes | Uses calendar days | Placement                                                                                                                                  |
| ----------- | ---------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `work`      | yes              | yes                | Takes minutes from as many days as needed. Chunks are at least `minSlotMinutes` (30), except the last.                                     |
| `wait`      | no               | yes (`days`)       | Starts on its earliest day and ends `days` days later. Other work fills the time.                                                          |
| `fixed`     | yes (its length) | on one day         | On `fixedAt.day` at `fixedAt.time`. Never moved. Takes its length from that day's time. With no `fixedAt` yet, left out (`fixed_undated`). |
| `milestone` | no               | none               | A marker on the earliest day its predecessors allow.                                                                                       |

Statuses: `not_started`, `in_progress` (its `minutes` are what is left), `done` (needs `doneOn`), `cancelled`.
A manual `hold` takes a task out of the plan. A done task satisfies its successors from `doneOn`, and it cuts the chain:
work behind a done task that was skipped and is still open does not have to come first any more. A cancelled task is
ignored as if it had never existed.

## Meaning of a day and a link

- A task has a `start` day and a `finish` day. For work it is the first and last day with minutes. A wait that begins
  on day S finishes on day S + `days`, so one day means "overnight".
- A link means: `successor.start >= predecessor.finish + lagDays`. With `lagDays = 0` they may share a day, and the
  predecessor comes first on that day. Lag is calendar days, so rest over a weekend counts.
- A task may not start before `today`, its `notBefore`, or the `expectedOn` of a blocking prerequisite that is not yet
  received. A blocking prerequisite with no date leaves its tasks unplanned, and says so. It never guesses a date.
- An order's last working day is `deliveryOn - 1 - bufferDays`. The handover day and the buffer are reserved.
- Links across orders are refused. Studio work (no order) has no promise and is planned last.

## Six steps

1. **Validate.** Refuses with a clear message instead of guessing: a cycle, a task with no estimate, a done task with
   no date, fixed or locked work in the past, a fixed time that is not a clock time, two pinned things that contradict
   each other, an unknown reference. A fixed event with no day yet is not refused: it is left out of the plan, with
   the work after it, and named (`fixed_undated`, decision 0032).
2. **Forward pass.** For each task, the earliest it can finish, alone and starting today. These are proven lower
   bounds: the chain of waits and links, and the capacity needed by the task together with the work that must come
   before it. They hold for every plan that respects all the links. (When she has fixed something earlier than the work
   it needs, the plan has to break that link, and says so with `fixed_before_predecessor`.) The same argument applies to
   a whole order. If an order's bound passes the day before handover, no plan can keep the promise: it is `infeasible`.
3. **Backward pass.** For each task, the latest it can finish and still deliver. The gap to the forward pass is slack.
4. **Allocate.** Pinned things first (fixed events, locked slots). Then everything else, one task at a time, by: in
   progress first, least slack, earliest delivery, `priority`, then id. Each task takes the earliest days with spare
   time after its predecessors. Front-loading leaves the buffer at the end, where surprises land.
5. **Check every promise.** Each order's state is computed from the finished plan, never stored.
6. **Explain.** Every finding is a typed `code` with its `numbers`, plus an English `message`.

## Order states

| State        | Meaning                                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------------------------- |
| `infeasible` | Even with every hour of hers, the order cannot be ready the day before handover. Says by how many days.       |
| `at_risk`    | Possible, but the plan eats into the buffer, runs late, leaves something unplanned or depends on a late item. |
| `on_track`   | Everything is planned and finishes by the order's last working day.                                           |

An order is `infeasible` only when the calendar itself proves it: the bound is finite, or handover falls inside the
calendar. If the calendar ends first, the engine cannot tell, and says `at_risk` with `no_room_in_calendar`. A task that
found no room still counts: an order whose work cannot be placed before handover is the clearest case of `infeasible`.

An order with nothing left to do (every task done) is `on_track`: there is nothing left to plan.

`readyOn` is the day the plan has everything finished. It is empty while any task of the order is left out
(`complete: false`), because with a task missing there is no day to promise. The findings then talk about "the work
planned for" the order instead.

## Pinned things

Fixed events and locked slots are placed exactly where she put them. That is explicit permission, so they may sit on a
day the calendar marks closed, or be longer than the day. The engine reports that as information and plans the rest
around it.

A pinned task is never dropped because of something else. Only a hold, which is her own instruction, removes it. If it
stands on shaky ground, it stays and the engine says what is missing:

| Finding                     | When                                                                                                      |
| --------------------------- | --------------------------------------------------------------------------------------------------------- |
| `fixed_before_predecessor`  | The work before it finishes after it starts: "the fitting is Thursday but the bodice finishes Friday".    |
| `fixed_before_prerequisite` | The material it needs is expected after it starts: "the fitting is Thursday but the lace arrives Friday". |
| `prerequisite_undated`      | The material it needs has no expected date.                                                               |
| `predecessor_unplanned`     | The work before it is not in the plan (on hold, or no room).                                              |

Two fixed events on one day, one meant to follow the other, must have clock times that agree, or the engine refuses
(`pinned_contradiction`), because the day could not be shown in an order that makes sense.

## The order of a day

Each slot has a `rank` within its day, 1 first. Every task comes after the tasks it follows. Among those free to go
next, fixed events come first, by clock time, then the work, the most urgent first. So a fitting leads the day unless
work has to be finished before it.

## All findings

| Code                         | Severity | About                                                                   |
| ---------------------------- | -------- | ----------------------------------------------------------------------- |
| `order_cannot_make_delivery` | problem  | An infeasible order, with the hours it needs and the hours she has.     |
| `order_late`                 | problem  | The plan misses handover although someone could have made it.           |
| `buffer_used`                | warning  | The plan eats into the buffer.                                          |
| `capacity_shared`            | warning  | On its own the order could be ready sooner; her time is shared.         |
| `task_after_latest_finish`   | warning  | The first late task of a chain, naming what it waits for.               |
| `fixed_before_predecessor`   | problem  | See pinned things.                                                      |
| `fixed_before_prerequisite`  | problem  | See pinned things.                                                      |
| `task_on_hold`               | warning  | Left out because she held it.                                           |
| `fixed_undated`              | warning  | An appointment with no day yet; it and the work after it are left out.  |
| `prerequisite_undated`       | warning  | Left out (or, if pinned, shaky) because something it needs has no date. |
| `predecessor_unplanned`      | warning  | Left out (or, if pinned, shaky) because work before it is not planned.  |
| `no_room_in_calendar`        | problem  | The planning calendar has no room for it.                               |
| `pinned_on_closed_day`       | info     | She set it on a day marked closed. It stays.                            |
| `pinned_over_capacity`       | info     | Her own bookings overfill a day. Nothing else is added to it.           |

## What the tests hold to

No day carries more planned time than its free capacity. No task starts before its predecessors and lag. Pinned things
never move, and are never dropped but by a hold. Nothing is planned on a closed day unless she pinned it. Same input
twice gives identical output, and so does the same input in another order. Every infeasible order has a reason with
numbers. Every fixed task that is missing something says what.

Three kinds of test, in `src/domain/engine`:

- **Examples** (`plan.test.ts`, `validate.test.ts`, `diff.test.ts`, `calendar.test.ts`): small situations with the
  answer worked out by hand.
- **Stories** (`fixtures.test.ts`): the bridal gown from first pattern to last stitch, the lace arriving late, a busy
  fortnight, and a dress that cannot be made.
- **Properties** (`properties.test.ts`): rules that must hold for any situation, tried on hundreds of random atelier
  weeks. `soundness.test.ts` checks "cannot be made" against a search that tries every way of spending her minutes, and
  for tasks that depend on nothing it must match that search exactly.

The random tests use a fixed seed, so a failure is never a surprise from nowhere. `npm run test:fuzz` tries many more
with a new seed and prints it, so any failure can be repeated: `npm run test:fuzz -- <seed> <runs>`.
