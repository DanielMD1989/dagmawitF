# Templates and proposal: from an order to an approved plan

Stage 3. The agreed contract for templates, an order's tasks, and how a plan is proposed and approved. The engine itself
is in [engine.md](engine.md); the orders it plans are in [capture.md](capture.md). The reasons are in decisions 0030 to 0037. If code and this page disagree, one of them is a bug.

## The idea in one paragraph

Her **library** holds a template for each kind of garment she makes: the tasks, how long each takes in her hands, which
task follows which, and what the garment waits for (fabric, lace, approval). **Applying** a template to a garment copies
all of it into the order, where she can change anything. A **proposal** is the engine's plan for the whole atelier,
because every order shares her hours. She **reviews** it (what each order's state is, what needs her attention, how full
each week is) and **approves** or rejects it. The approved plan is what My Day will read in Stage 4.

## What is stored

| Table                   | Holds                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------ |
| `template`              | Name, garment type, notes, `version` (counts up on every change to it or its parts).             |
| `template_task`         | Title, kind, minutes (work, appointment) or days (wait), position.                               |
| `template_edge`         | Which task follows which in the same template, and the rest days (`lag_days`) between them.      |
| `template_prerequisite` | What a garment of this kind waits for: kind, label, blocking.                                    |
| `template_requires`     | Which task cannot start until which of those has arrived.                                        |
| `task`                  | One step of one garment of one order. No dates: dates are the plan's.                            |
| `task_edge`             | Which task follows which in the same order, with `lag_days`.                                     |
| `task_requires`         | Which task waits for which preparation item of the same order.                                   |
| `plan_version`          | A proposal or an approved plan: number, status, the plan it was built on, the engine's findings. |
| `plan_slot`             | Minutes of one task on one day in one plan version, with its place in the day.                   |

`order_item` gains `template_id` and `template_version`: which template, at which version, the garment was planned
from. `profile` gains `plan_epoch` (see "When a plan is out of date").

## Tasks

Four kinds, the engine's four, in her words:

| Kind        | On screen   | Needs                               | Example                             |
| ----------- | ----------- | ----------------------------------- | ----------------------------------- |
| `work`      | Work        | minutes (1 minute to 100 hours)     | Construct bodice, 8h                |
| `wait`      | Wait        | days (1 to 60); none of her time    | Fabric drying after pre-wash, 1 day |
| `fixed`     | Appointment | minutes, and a day and a clock time | First fitting, Tue 3 Nov 10:30, 1h  |
| `milestone` | Milestone   | nothing                             | Ready for handover                  |

- An appointment in a template has no day: the day is agreed with the client later. Until it has one, the engine leaves
  it and everything after it out of the plan and says so (`fixed_undated`). The order shows as at risk. It never
  guesses a day.
- A task may have a "not before" day (the client is away until then).
- A link says a task cannot start until another has finished, plus `lag_days` calendar days of rest. Links stay inside
  one order and inside one template. A loop of links is refused by the database when it is written.
- A task waits for any number of preparation items of its own order. A blocking item that has not arrived holds it
  until its expected day; with no expected day it holds it out of the plan, as in Stage 2.
- Tasks, links and requirements of a delivered or cancelled order are frozen, like the rest of the order
  (decision 0025).

## Applying a template

`apply_template(garment, template)` runs in one transaction:

1. The garment must have no tasks yet. To start again she removes its tasks first.
2. Each template prerequisite is matched with a preparation item of the order by its label, ignoring capitals and
   spaces at either end. If none matches, it is added (as Needed). So "Lace" added by a quick-add button in Stage 2 is
   the same item the template's "Apply lace" waits for.
3. Tasks, links and requirements are copied, in the template's order.
4. The garment records the template and its version. The history says `template_applied`.

Editing the template later changes nothing in orders already planned. Deleting it leaves the copies alone.

## Starter templates

Every account starts with three: **Bridal gown**, **Evening dress** and **Suit alteration**. Their durations are a
starting point written without her and must be replaced with her own times, from real orders, before a plan is trusted
(the Stage 3 exit test). They are ordinary templates: rename, change or delete them.

## Proposing a plan

The server gathers the planning facts and calls the engine:

| Engine input    | From                                                                                                                                        |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `today`         | Her today, in her time zone.                                                                                                                |
| `calendar`      | `buildCalendar` from her week, days off and planning ratio, from today to 30 days after the last handover (at least 120 days, at most 730). |
| `orders`        | Active orders only. Drafts, held, delivered and cancelled orders take none of her time.                                                     |
| `tasks`         | The tasks of those orders.                                                                                                                  |
| `edges`         | Their links.                                                                                                                                |
| `prerequisites` | The preparation items of those orders.                                                                                                      |
| `requirements`  | Their requirements.                                                                                                                         |

The mapping is one pure function, `buildPlanInput` (`src/domain/planning/input.ts`), tested on its own.

- If the engine refuses (a fitting in the past, for example), nothing is stored and she sees each reason with a link to
  the task.
- Otherwise the result is stored as a new `plan_version` with status `proposed`, its slots, the engine's findings, the
  calendar it used, and the task titles and order labels of that moment (so an old plan still reads sensibly). It is
  stored by one database function, `save_proposal`, which refuses if the planning facts changed while the plan was
  being made.

## Reviewing

`/plan/[number]` shows one proposal. Opened from an order (`?order=<id>`) it leads with that order:

- **The order's state** (on track, at risk, cannot be made), how much of its work is placed, and its ready day against
  the handover day.
- **Needs your attention**: the engine's findings for the order that she can act on, problems first and causes before
  their effects, each with the garment it is about and a link to what to change. Tasks left out only because the work
  before them is left out are folded under "N more tasks wait behind these" (decision 0039). An order with no tasks
  says "No tasks yet" rather than a state.
- **The schedule**: each task, its kind, estimate and planned days, or why it is not planned.
- **Shared capacity**: for each week the order touches, her usable time, how much this order takes, how much the other
  orders take, and what is still free.
- **What else changes**: compared with the approved plan, the orders whose ready day moves or whose state gets worse.

Without `?order=` it lists every order in the plan with its state.

## Approving

`approve_plan(number)` is one database function. It refuses, with a sentence she can act on, when:

- the proposal is not `proposed` (already approved, rejected or replaced);
- it was made for an earlier day (`made_for` is not her today): make a new one;
- the planning facts changed since it was made (`epoch` differs): make a new one;
- another plan was approved since it was made (`base_number` is not the current approved plan).

Otherwise the approved plan becomes `superseded`, every other open proposal becomes `superseded`, and this one becomes
`approved`. Only one plan is ever approved (a unique index holds it). Each order in the plan gets a `plan_approved`
history row with its state and ready day. `reject_plan(number)` marks a proposal `rejected`. Plans are never edited or
deleted through the API.

## When a plan is out of date

`profile.plan_epoch` counts up whenever a planning fact changes, by trigger:

- a task, link or requirement is added, changed or removed;
- a preparation item is added or removed, or its state, expected day or blocking changes;
- an order is created or deleted, or its status, handover day or buffer changes;
- her working week, days off, planning ratio or time zone change.

A proposal keeps the epoch it was made at. The approved plan is **current** when its epoch is the profile's and it was
made for today; otherwise screens say it is out of date and offer a new proposal. Approval checks the same thing in the
database, so a plan built on facts that have changed can never be approved.

## Screens

| Route               | Shows                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `/library`          | Her templates: garment type, number of tasks, hours of work.                                                              |
| `/library/new`      | Name and garment type; tasks are added on the next page.                                                                  |
| `/library/[id]`     | One template: details, tasks with their links and what they wait for, its preparation.                                    |
| `/orders/[id]/plan` | The order's tasks per garment: apply a template, edit tasks and links, the approved plan for this order, Make a proposal. |
| `/plan`             | The approved plan, open proposals, and earlier plans.                                                                     |
| `/plan/[number]`    | One proposal or plan, reviewed as above, with Approve and Reject.                                                         |

Library joins the navigation (decision 0024 said it would arrive with its stage). The plans list is reached from My
Day and from each order's Plan tab until the Planner arrives in Stage 5 (decision 0038).

## Known limits

- An appointment whose day has passed makes the engine refuse every proposal ("fixed on a day that has passed: mark it
  done or move it"). Since Stage 4 she marks it done on My Day or in the end-of-day review.
- The starter templates' durations are guesses.
- Reordering tasks by hand is not offered: a list is always shown in the order the links give the work.

## How it is tested

1. **Engine**: the new `fixed_undated` finding (examples and the random properties).
2. **Domain**: task and template forms, `buildPlanInput` (which orders, which tasks, undated appointments, the
   calendar's length), the review's numbers (placed work, weeks and their capacity, what changed).
3. **Database**: owner isolation for every new table, links that try to cross orders or templates, loops, the closed
   order freeze, `apply_template` (copying, matching preparation by label, refusing a garment that has tasks), the
   epoch rising for every planning fact and not for anything else, `save_proposal` and `approve_plan` refusing each
   stale case, one approved plan at most, and history.
4. **Browser**: a template is edited, applied to an order, the fitting is given a day, a proposal is made, read and
   approved; a stale proposal cannot be approved.

## Exit test (manual)

One real order has an approved plan that she agrees is believable. Before that, she replaces the starter durations with
her own, from orders she has made.
