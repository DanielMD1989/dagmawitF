-- Stage 5: moving a piece of work to a day. The model and the reasons are in docs/change.md and decisions 0046 to 0050.

-- A piece of work pinned to a day: the engine places all its remaining minutes there and plans the rest around it.
-- Only her own work can be pinned; an appointment has its day and time, a wait and a milestone have no minutes.
alter table public.task
  add column pinned_on date check (pinned_on between date '2000-01-01' and date '2099-12-31'),
  add constraint task_only_work_is_pinned check (pinned_on is null or kind = 'work');

grant update (pinned_on) on public.task to authenticated;

-- A pin changes the shape of the plan (decision 0040), so it raises plan_epoch like the other columns.
drop trigger task_epoch_update on public.task;
create trigger task_epoch_update after update on public.task
  for each row when ((new.title, new.kind, new.minutes, new.days, new.fixed_on, new.fixed_time, new.not_before,
                      new.hold_reason, new.order_id, new.sort, new.pinned_on)
                     is distinct from (old.title, old.kind, old.minutes, old.days, old.fixed_on, old.fixed_time,
                                       old.not_before, old.hold_reason, old.order_id, old.sort, old.pinned_on))
  execute function app.planning_fact_changed();
