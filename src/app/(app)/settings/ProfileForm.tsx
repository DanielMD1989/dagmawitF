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

  return (
    <form action={action} className="form" noValidate>
      <TextField
        name="name"
        label="Your name"
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
      <FormNotice state={state} />
      <div className="btn-row">
        <SubmitButton>Save details</SubmitButton>
      </div>
    </form>
  );
}
