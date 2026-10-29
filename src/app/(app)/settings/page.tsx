import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { ThemeSwitch } from '@/components/ThemeSwitch';
import { SignOutForm } from '@/components/offline/SignOutForm';
import { formatMinutes } from '@/domain/duration';
import { formatDay } from '@/domain/dates';
import { usableMinutes, workingMinutes } from '@/domain/calendar/capacity';
import { THEME_COOKIE, parseTheme } from '@/lib/theme';
import { loadCalendarSettings } from '@/server/calendar';
import { loadPreferences } from '@/server/preferences';
import { requireUser } from '@/server/session';
import { createSupabase } from '@/server/supabase';
import { ExceptionForm } from './ExceptionForm';
import { OrderDefaultsForm } from './OrderDefaultsForm';
import { PasswordForm } from './PasswordForm';
import { ProfileForm } from './ProfileForm';
import { TidyForm } from './TidyForm';
import { WorkWeekForm } from './WorkWeekForm';
import { removeException, signOut } from './actions';

export const metadata: Metadata = { title: 'Settings' };

export default async function SettingsPage() {
  const user = await requireUser();
  const supabase = await createSupabase();
  const [{ profile, week, exceptions, today }, preferences] = await Promise.all([
    loadCalendarSettings(supabase),
    loadPreferences(supabase),
  ]);
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);

  const weeklyWorking = week.reduce((sum, d) => sum + workingMinutes(d), 0);
  const weeklyUsable = week.reduce(
    (sum, d) => sum + usableMinutes(workingMinutes(d), profile.planningRatio),
    0,
  );
  const zones = Intl.supportedValuesOf('timeZone');
  const timeZones = zones.includes(profile.timezone) ? zones : [profile.timezone, ...zones];

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">Settings</p>
        <h1>Her week and her days off</h1>
        <p className="lede">
          The planner only ever uses the time set here. Change it and every plan follows.
        </p>
      </div>

      <section className="section" aria-labelledby="week-heading">
        <div className="section__head">
          <h2 id="week-heading">Working week</h2>
          <p className="hint">Tick the days she works, then set her hours and her usual break.</p>
        </div>
        <WorkWeekForm week={week} />
        <div className="card" role="status">
          <p>
            {week.length === 0 ? (
              <>No working days saved yet. Until some are, nothing can be planned.</>
            ) : (
              <>
                <strong>{formatMinutes(weeklyWorking)}</strong> of work a week, of which the planner will fill{' '}
                <strong>{formatMinutes(weeklyUsable)}</strong> ({Math.round(profile.planningRatio * 100)}%).
              </>
            )}
          </p>
        </div>
      </section>

      <section className="section" aria-labelledby="off-heading">
        <div className="section__head">
          <h2 id="off-heading">Days off and shorter days</h2>
          <p className="hint">Holidays, leave and half days. These replace her usual week for that date.</p>
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

      <section className="section" aria-labelledby="orders-heading">
        <div className="section__head">
          <h2 id="orders-heading">Orders and measurements</h2>
        </div>
        <OrderDefaultsForm
          defaults={{
            defaultBufferDays: preferences.defaultBufferDays,
            measurementUnit: preferences.measurementUnit,
          }}
        />
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

      <section className="section" aria-labelledby="look-heading">
        <div className="section__head">
          <h2 id="look-heading">Appearance</h2>
          <p className="hint">Night is a soft dark made for evenings.</p>
        </div>
        <ThemeSwitch current={theme} />
      </section>

      <section className="section" aria-labelledby="data-heading">
        <div className="section__head">
          <h2 id="data-heading">Her data</h2>
          <p className="hint">
            Everything she has entered, and her pictures, in one file. Keep a copy somewhere safe, away from
            her phone; whoever looks after the app can bring it back from that file.
          </p>
        </div>
        <div className="btn-row">
          <a href="/api/export" className="btn" download>
            Download everything
          </a>
        </div>
        <p className="hint">
          Pictures can be left stored with nothing pointing at them if a save was cut off halfway. Tidying
          removes them; nothing she can see changes.
        </p>
        <TidyForm />
      </section>

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
