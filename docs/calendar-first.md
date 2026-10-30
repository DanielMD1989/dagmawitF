# Calendar first: the agreed redesign

Agreed with Daniel on 30 October 2026, after Dagmawit's first real use (decision 0066). This page is the plan every
change follows until it is done. If something here turns out wrong, change this page first, then the code.

## What she told us

- Her work comes as **jobs of different kinds**: a new order, a fix, an appointment, a sketch, or just a delivery of
  something already finished.
- Once a design is agreed and an order placed, the order goes through **steps**: buy fabric, cut, sew, fittings,
  delivery.
- Every step has **a day on the calendar**. Hours are optional: on a given day she may note the time she will spend
  on it ("Sewing, Tue 10 Nov, 9:00 to 13:00").
- The app forced her to estimate hours for every task and planned nothing until every date was known. That is the gap.

## Her answers (30 October)

1. A step has a day, or a run of days; optionally a time on its day. "A little of both."
2. For a new order with a delivery day, the app **suggests** each step's day, counting back from delivery; she changes
   any of them.
3. The app opens on **today and the week ahead**, a list by day. A month view is one tap away.

## The model

| Thing    | What it is                                                                                          |
| -------- | --------------------------------------------------------------------------------------------------- |
| Client   | Unchanged: name, phone, measurements over time.                                                     |
| Job      | The `orders` table, plus a **kind**: new order, fix, appointment, sketch, delivery. Has a due day.  |
| Step     | The `task` table, reshaped: title, a day (`on`), an optional last day, optional from/to time, done. |
| Template | A named list of steps, each with "days before the due day", to suggest days. No hours.              |
| Calendar | Every open step with a day, from every open job, by day. Overdue first.                             |

Each kind starts with its own steps (she can change the list in Library):

| Kind        | Steps it starts with                                                            |
| ----------- | ------------------------------------------------------------------------------- |
| New order   | Buy fabric, Cutting, Sewing, First fitting, Second fitting, Finishing, Delivery |
| Fix         | Fix, Delivery                                                                   |
| Appointment | Appointment (with a time)                                                       |
| Sketch      | Sketch, Show the client                                                         |
| Delivery    | Delivery                                                                        |

Suggested days skip the days she does not work (her working week and days off stay, for this only). A suggestion is
just a starting value: the step stores the day she keeps.

## Warnings, simply

- A step whose day has passed and is not done: **overdue**, at the top of today.
- A step dated after its job's due day: shown on the job, in plain words.
- Two appointments at the same time: shown on that day.

Nothing is blocked. Nothing needs approving.

## What goes

- Hour estimates and her daily capacity ("share of working time to plan").
- The planning engine, proposals, plan versions, "approve", the planner week view and "Save and see impact".
- Links between tasks, and preparation items that hold work back. Buying fabric is now a step with a day.
- The garment requirement for confirming a job: an appointment or a sketch has no garment. Garments stay, for orders
  and fixes, with their brief, measurements and pictures.

Moving a job's due day offers to move its open steps by the same number of days.

## Words

The app speaks to her: "your week", "what you are making", never "her". Plain words for the kinds and steps.

## Order of work

1. Database: a migration that adds the job kind and reshapes steps, moves existing tasks to days (an appointment's
   day, or the day an approved plan gave it), and drops the plan tables. Database tests updated first.
2. Domain: step-day suggestion (counting back, skipping closed days) and the calendar list, with unit tests.
3. Screens: Today and the week; month; new job (kind first); job page with its steps; Library templates without hours;
   Settings without capacity; the words.
4. Browser suite rewritten as her story with the new screens; axe on every screen.
5. Docs, CI green, deployed. Then she uses it for a week, and we write down what is still missing.

## Second round: jobs she builds (30 October, decision 0068)

After a day of use she said "kind of job" does not fit: work moves through stages (an appointment, a sketch, fabric,
production, delivery), any of which may be missing; a fix may start with an appointment; and bazaars are events with
no client. Her answers: **she sets each step's day herself**, and Today shows **days left for events and deliveries**.

- **No kind.** A job is: who it is for (a client, or nobody: an event such as a bazaar), what it is (a few words), its
  day (delivery, or the event), and its steps.
- **Steps are built on the job.** Her usual steps are offered as buttons (Appointment, Sketch, Buy fabric, Cutting,
  Sewing, Fitting, Fix, Delivery, and every step she has typed before, most used first); a tap adds it, she gives it
  its day and, if she wants, a time. Any step can be typed new.
- **No saved lists** (decision 0075, replacing the first version's Library). Her steps are the same few every time, so
  the step buttons are all she needs: the common steps, and any step of hers she has used more than once.
- **No suggested days.** Nothing is counted back; the app keeps what she sets.
- **Days left.** Today lists what is coming up: "Bazaar at Hyatt · 12 days left". Every event ahead is there from the
  day she adds it, however far, because a bazaar or a fashion show needs weeks of preparation (her words: "needs my
  attention"); deliveries show in their last 30 days. A job's page says it too. Preparation is steps over several days
  (a day and a last day), shown on each of them.
- **The work is the headline.** On Today and the calendar an entry reads "Megan · Bridal gown", with the step under it.
- **Delete any job** made by mistake, whatever its state; cancel one to keep it on record.
- **An event is just an event** (decision 0069): "New event" asks for its name and day, nothing about clients or
  garments. Preparation, if she wants it on the calendar, goes under "To prepare" on the event's page.
- **Usual steps are the ones she repeats**: a title she typed once is not offered as a button.
- **Times stay hers once** (decision 0067): a step's time that crosses another is refused, including two steps of the
  same new job.
