import type { Metadata } from 'next';
import Link from 'next/link';
import { ConfirmAction } from '@/components/ConfirmAction';
import { SignOutForm } from '@/components/offline/SignOutForm';
import { formatMinutes } from '@/domain/duration';
import { formatDay } from '@/domain/dates';
import { loadCalendarSettings } from '@/server/calendar';
import { pushPublicKey } from '@/server/news';
import { loadPeople, personName } from '@/server/people';
import { loadPreferences } from '@/server/preferences';
import { requireUser } from '@/server/session';
import { createSupabase } from '@/server/supabase';
import { ExceptionForm } from './ExceptionForm';
import { MeasurementUnitForm } from './MeasurementUnitForm';
import { PasswordForm } from './PasswordForm';
import { ProfileForm } from './ProfileForm';
import { TidyForm } from './TidyForm';
import { WorkWeekForm } from './WorkWeekForm';
import { NotificationsSwitch } from './NotificationsSwitch';
import { AddPersonForm } from './PeopleForm';
import { removeException, removePerson, signOut } from './actions';

export const metadata: Metadata = { title: 'Settings' };

export default async function SettingsPage() {
  const user = await requireUser();
  const supabase = await createSupabase();
  const [{ profile, week, exceptions, today }, preferences, people] = await Promise.all([
    loadCalendarSettings(supabase),
    loadPreferences(supabase),
    loadPeople(supabase),
  ]);
  const publicKey = await pushPublicKey();
  const owner = people.find((p) => p.isOwner);
  const iAmOwner = owner?.isMe ?? true;

  const zones = Intl.supportedValuesOf('timeZone');
  const timeZones = zones.includes(profile.timezone) ? zones : [profile.timezone, ...zones];

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">Settings</p>
        <h1>Your week and your days off</h1>
        <p className="lede">
          When a new job’s steps are given their days, they go on the days you work. Nothing else depends on
          it.
        </p>
      </div>

      <section className="section" aria-labelledby="week-heading">
        <div className="section__head">
          <h2 id="week-heading">Working week</h2>
          <p className="hint">
            Tick the days you work. The hours are for you to see; nothing is planned by the hour.
          </p>
        </div>
        <WorkWeekForm week={week} />
        {week.length === 0 && (
          <div className="card" role="status">
            <p>No working days saved. Steps are then suggested on any day of the week.</p>
          </div>
        )}
      </section>

      <section className="section" aria-labelledby="off-heading">
        <div className="section__head">
          <h2 id="off-heading">Days off and shorter days</h2>
          <p className="hint">Holidays and leave. No step is suggested on a day off.</p>
        </div>
        {exceptions.length > 0 && (
          <ul className="rows">
            {exceptions.map((e) => (
              <li key={e.id}>
                <div className="rows__main">
                  <span className="rows__title">
                    {formatDay(e.day)} ·{' '}
                    {e.minutesAvailable === 0 ? 'Closed' : `${formatMinutes(e.minutesAvailable)} of work`}
                  </span>
                  {e.reason && <span className="hint">{e.reason}</span>}
                </div>
                <form action={removeException}>
                  <input type="hidden" name="id" value={e.id} />
                  <button type="submit" className="btn btn--quiet" aria-label={`Remove ${formatDay(e.day)}`}>
                    Remove
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
        <ExceptionForm today={today} />
      </section>

      <section className="section" aria-labelledby="details-heading">
        <div className="section__head">
          <h2 id="details-heading">Details</h2>
        </div>
        <ProfileForm profile={profile} timeZones={timeZones} />
      </section>

      <section className="section" aria-labelledby="measure-heading">
        <div className="section__head">
          <h2 id="measure-heading">Measurements</h2>
        </div>
        <MeasurementUnitForm unit={preferences.measurementUnit} />
        <div className="card">
          <h3>Your list of measurements</h3>
          <p className="hint">The measurements you take from every client, in your words and your order.</p>
          <div className="btn-row">
            <Link href="/settings/measurements" className="btn btn--quiet">
              Edit the list
            </Link>
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="notify-heading">
        <div className="section__head">
          <h2 id="notify-heading">Notifications</h2>
          <p className="hint">
            When someone else of this workspace adds or changes a job, or ticks a step done.
          </p>
        </div>
        <NotificationsSwitch publicKey={publicKey} />
      </section>

      <section className="section" aria-labelledby="people-heading">
        <div className="section__head">
          <h2 id="people-heading">People</h2>
          <p className="hint">
            {iAmOwner
              ? 'Someone who works with you sees and changes everything here: clients, jobs, the calendar.'
              : `You work in ${owner ? personName(owner) : 'another'}’s workspace: you see and change everything in it.`}
          </p>
        </div>
        <ul className="rows" aria-label="People of this workspace">
          {people.map((p) => (
            <li key={p.id}>
              <div className="rows__main">
                <span className="rows__title">
                  {personName(p)}
                  {p.isMe && ' (you)'}
                </span>
                <span className="hint">
                  {p.email}
                  {p.isOwner ? ' · owner' : ''}
                </span>
              </div>
              {!p.isOwner && (iAmOwner || p.isMe) && (
                <ConfirmAction
                  action={removePerson}
                  fields={{ id: p.id }}
                  label={p.isMe ? 'Leave' : 'Remove'}
                  question={
                    p.isMe
                      ? 'Leave this workspace? You will no longer see its clients and jobs.'
                      : `Remove ${personName(p)}? They will no longer see anything here.`
                  }
                  confirmLabel={p.isMe ? 'Yes, leave' : 'Yes, remove'}
                />
              )}
            </li>
          ))}
        </ul>
        {iAmOwner && (
          <details className="disclosure disclosure--link">
            <summary>Add a person</summary>
            <div className="disclosure__panel">
              <AddPersonForm />
            </div>
          </details>
        )}
      </section>

      {/* The workspace's file is its owner's to download (decision 0081). */}
      {iAmOwner && (
        <section className="section" aria-labelledby="data-heading">
          <div className="section__head">
            <h2 id="data-heading">Your data</h2>
            <p className="hint">
              Everything you have entered, and your pictures, in one file. Keep a copy somewhere safe, away
              from your phone; whoever looks after the app can bring it back from that file.
            </p>
          </div>
          <div className="btn-row">
            <a href="/api/export" className="btn" download>
              Download everything
            </a>
          </div>
          <p className="hint">
            Pictures can be left stored with nothing pointing at them if a save was cut off halfway. Tidying
            removes them; nothing you can see changes.
          </p>
          <TidyForm />
        </section>
      )}

      <section className="section" aria-labelledby="account-heading">
        <div className="section__head">
          <h2 id="account-heading">Account</h2>
          <p className="hint">Signed in as {user.email ?? 'this account'}.</p>
        </div>
        <details className="disclosure disclosure--link">
          <summary>Change the password</summary>
          <div className="disclosure__panel">
            <PasswordForm />
          </div>
        </details>
        <SignOutForm action={signOut} />
      </section>
    </>
  );
}
