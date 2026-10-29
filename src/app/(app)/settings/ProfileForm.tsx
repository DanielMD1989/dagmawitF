'use client';

import { useActionState } from 'react';
import { FormNotice } from '@/components/FormNotice';
import { SubmitButton } from '@/components/SubmitButton';
import { SelectField, TextField } from '@/components/fields';
import { idle } from '@/lib/action-state';
import type { Profile } from '@/domain/calendar/types';
import { saveProfile } from './actions';

export function ProfileForm({ profile, timeZones }: { profile: Profile; timeZones: string[] }) {
  const [state, action] = useActionState(saveProfile, idle);
  const percent = Math.round(profile.planningRatio * 100);

  return (
    <form action={action} className="form" noValidate>
      <TextField
        name="name"
        label="Her name"
        state={state}
        saved={profile.name}
        autoComplete="name"
        maxLength={120}
      />
      <SelectField
        name="timezone"
        label="Time zone"
        state={state}
        saved={profile.timezone}
        options={timeZones.map((zone) => ({ value: zone, label: zone.replaceAll('_', ' ') }))}
      />
      <TextField
        name="planning-percent"
        label="Share of working time to plan (%)"
        type="number"
        inputMode="numeric"
        min={30}
        max={100}
        step={1}
        state={state}
        saved={String(percent)}
        hint="The planner fills only this much of each day. The rest stays free for walk-ins and jobs that run long. 70 is a good start."
      />
      <FormNotice state={state} />
      <div className="btn-row">
        <SubmitButton>Save details</SubmitButton>
      </div>
    </form>
  );
}
