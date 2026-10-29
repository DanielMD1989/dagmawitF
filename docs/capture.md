# Capture: clients, measurements, orders

The agreed model for Stage 2. The reasons are in [decisions.md](decisions.md) (0018 to 0024). If code and this page
disagree, one of them is a bug: fix the cause, never the test.

Stage 2 is where facts enter the system: who the client is, what she measured, what the garment is, when it is promised,
what she is waiting for, and what it looks like. Nothing here plans anything. The scheduling engine reads these facts in
Stage 3. So every field below is either something the engine needs, or something she would otherwise have to remember.

## What is stored

| Table               | What it holds                                                                            | Notes                                                                                                      |
| ------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `client`            | name, phone, notes                                                                       | Only what planning and a phone call need. A client with orders cannot be deleted.                          |
| `measurement_field` | her own list of measurements: `key`, `label`, `sort`, `archived`                         | Seeded with a starter list. A field is renamed or hidden, never deleted, so old measurements stay legible. |
| `measurement_set`   | one client's measurements on one day: `version`, `taken_on`, `unit`, `values`, `note`    | Never edited. A change is a new version. An order's garment points at the version it was planned with.     |
| `orders`            | `number`, client, `status`, `delivery_on`, `buffer_days`, reasons, `delivered_on`, notes | Named `orders` because `order` is a reserved word in SQL.                                                  |
| `order_item`        | one garment: `garment_type`, `brief`, the measurement version                            | One order can have several garments (a bridal gown and two bridesmaid dresses).                            |
| `prerequisite`      | something an order waits for: `kind`, `label`, `state`, `expected_on`, `blocking`        | Fabric, lace, an approval, a booked measuring. The engine reads `state`, `expected_on` and `blocking`.     |
| `attachment`        | a sketch or photo: `kind`, `caption`, `version`, where the file is stored                | The file itself is in private storage.                                                                     |
| `activity_log`      | what happened to an order, and when                                                      | Written by the database, never by a screen. Append only.                                                   |

`profile` gains two defaults: `default_buffer_days` (2) and `measurement_unit` (`cm`).

## Order status

Five stored statuses. Everything else she might call a status (in production, ready, late, blocked) is worked out from
the plan and never stored, so it cannot go stale.

| Status      | Meaning                                                                                             | Planned? |
| ----------- | --------------------------------------------------------------------------------------------------- | -------- |
| `draft`     | An enquiry or a half-entered order. Takes none of her time and promises nothing.                    | no       |
| `active`    | Confirmed. The handover day is a promise, and the planner makes room for it.                        | yes      |
| `on_hold`   | Paused with a reason (the client is away, the fabric is not coming). Frees her time.                | no       |
| `delivered` | Handed over. Set by an explicit action, with the day it happened.                                   | no       |
| `cancelled` | Called off, with an optional reason. Kept, because the history and the measurements are still hers. | no       |

Moves allowed (the only ones; the database refuses all others, and the same table drives the buttons on screen):

```
draft     → active, cancelled
active    → on_hold, delivered, cancelled
on_hold   → active, cancelled
delivered → active            (reopen)
cancelled → draft             (reopen; she confirms it again)
```

Rules that go with the moves:

- Becoming `active` (confirm, resume, reopen) needs at least one garment and a handover day of today or later. If the old
  date has passed, she chooses a new one in the same step.
- `on_hold` needs a reason. `delivered` needs the day it was delivered, not in the future.
- Leaving a status clears what belonged to it (the hold reason, the cancel reason, the delivered day).
- A `delivered` or `cancelled` order is frozen except its notes. To change anything she reopens it first, and that is
  logged.
- An `active` or `on_hold` order always has at least one garment.
- The number is chosen once (next after her highest, or one she types) and never changes.
- Only a `draft` can be deleted. Anything else is cancelled, so its history stays. A deleted draft's number is free
  again, because it promised nothing.
- A `delivered` or `cancelled` order is a record: the order, its garments, its preparation and its pictures cannot be
  changed until it is reopened (decision 0025). The database refuses it; the screens hide the editors.

## Measurements

- `values` is `{ field key: number }`. At least one value, each above zero and at most 500. Keys must be fields she has.
- Version numbers count up per client (1, 2, 3 ...) and are given by the database.
- The unit (`cm` or `in`) is a setting of hers. Each version keeps the unit it was taken in, so changing the setting
  later never rewrites an old measurement.
- Recording a version starts from the last one (same unit), so she changes only what changed.
- A garment is attached to the client's latest version when it is created. If a newer version appears later the order
  page says so, lists what changed, and offers to switch, because the garment may already be cut to the old numbers.
- When her first measurements are recorded from an order, the garments of that order that have none are given them
  (decision 0027).
- Her list of fields is renamed, reordered, hidden and added to in Settings. A rename shows in old versions too (they
  store the key). Reordering is one database call, `reorder_measurement_fields`.
- Settings also hold her defaults: days kept free before a handover (0 to 30) and the unit for new measurements.

## Preparation (prerequisites)

Kinds: `material`, `approval`, `measurements`, `other`. States: `needed`, `ordered`, `received`. The words on screen
depend on the kind (a material is Needed, Ordered, Received; an approval is Needed, Asked, Approved).

Blocking means the work that needs it cannot start until it is received. A non-blocking item is a reminder. A blocking
item with no expected date is the one that matters most: the engine cannot plan the work behind it, and says so. The
order page counts, for each order, how many items are ready, how many blocking items are open and how many have no date.

Which task needs which item is set in Stage 3, when tasks exist.

## Files

- Images only (JPEG, PNG, WebP), at most 5 MB each, at most 40 per order. A photo is shrunk in the browser to 1600
  pixels on its long side before it is sent.
- They live in the private bucket `order-files` under `<her id>/<order id>/<file id>`. Storage policies allow only the
  owner's folder.
- Nothing ever links to storage. Pages use `/files/<attachment id>`, which checks she is signed in and the file is hers,
  then redirects to a link that works for one minute.
- `version` counts per order and kind (Sketch 1, Sketch 2), so a revised sketch does not overwrite the first.
- Shown sketches first, then inspiration, fabric, fitting and other (decision 0029).
- Removing a picture removes the row first, then the stored file. If the file cannot be removed it is logged; nothing
  can reach it any more.

## History

The database writes a row for each of these, as a code plus a few facts. The words are made in one place
(`src/domain/orders/history.ts`), as for the engine's warnings.

`order_created`, `status_changed` (from, to, reason), `delivery_changed`, `buffer_changed`, `client_changed`,
`garment_added`, `garment_removed`, `prerequisite_added`, `prerequisite_changed`, `prerequisite_removed`,
`file_added`, `file_removed`, and for the client `measurements_recorded`.

## Screens

| Route                       | Shows                                                                                         |
| --------------------------- | --------------------------------------------------------------------------------------------- |
| `/orders`                   | Her orders by handover day. Filter by status. Each row: number, client, garments, readiness.  |
| `/orders/new`               | One form: client, garment, brief, handover day, buffer. Creates the order and its garment.    |
| `/orders/[id]`              | Design brief: garments, sketches and photos, notes. Status actions in the header.             |
| `/orders/[id]/measurements` | The measurement version each garment uses, and whether a newer one exists.                    |
| `/orders/[id]/preparation`  | What she is waiting for, grouped by kind, with a readiness summary and quick-add suggestions. |
| `/orders/[id]/history`      | What happened, newest first.                                                                  |
| `/clients`, `/clients/[id]` | Clients, their orders, their measurement versions, recording a new version.                   |
| `/settings`                 | Adds her order and measurement defaults to the Stage 0 settings.                              |
| `/settings/measurements`    | Her measurement list: rename, move up or down, hide, show again, add.                         |
| `/files/[id]`               | Opens a stored sketch or photo.                                                               |

The Plan, Quality and handover tabs of the design board arrive with Stages 3 to 5.

## How it is tested

1. **Domain**: the status table (every pair of statuses), every form's rules, readiness, history wording, file checks.
2. **Database**: the same rule cases run against real PostgreSQL (the status table, field limits, the freeze and delete
   rules), plus owner isolation for every new table, references that try to cross owners, immutable measurements,
   numbering, the history log and the storage policies.
3. **Browser**: `e2e/01-capture.spec.ts` (docs/testing.md), against the local Supabase stack: her working week, three
   orders entered (a bridal gown with a bridesmaid dress, an evening dress, a suit alteration), refused forms keeping
   what she typed, measurement versions and switching, a large phone photo shrunk before it is sent, wrong files
   refused, preparation items, every status move, deleting a draft, history, Settings. Every screen is checked for
   sideways scrolling and with axe (WCAG 2.2 AA) on a phone, on a desktop and at night.

## Exit test (manual)

She enters three of her current orders without help, and nothing she needs to remember is missing from the form. Where
she reaches for the notebook, that is a missing field: write down what it was, then add it.
