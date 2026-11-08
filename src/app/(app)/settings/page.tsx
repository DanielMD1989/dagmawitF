import type { Metadata } from 'next';
import { ConfirmAction } from '@/components/ConfirmAction';
import { SignOutForm } from '@/components/offline/SignOutForm';
import { pushPublicKey } from '@/server/news';
import { loadPeople, personName } from '@/server/people';
import { loadPreferences } from '@/server/preferences';
import { requireUser } from '@/server/session';
import { createSupabase } from '@/server/supabase';
import { PasswordForm } from './PasswordForm';
import { ProfileForm } from './ProfileForm';
import { TidyForm } from './TidyForm';
import { NotificationsSwitch } from './NotificationsSwitch';
import { AddPersonForm } from './PeopleForm';
import { removePerson, signOut } from './actions';

export const metadata: Metadata = { title: 'Settings' };

/**
 * Settings (decision 0093): her account (name, password, signing out), the people of the workspace, notifications on
 * this phone, and her data. Kept to that: the list of measurements is under Clients.
 */
export default async function SettingsPage() {
  const user = await requireUser();
  const supabase = await createSupabase();
  const [preferences, people] = await Promise.all([loadPreferences(supabase), loadPeople(supabase)]);
  const publicKey = await pushPublicKey();
  const owner = people.find((p) => p.isOwner);
  const iAmOwner = owner?.isMe ?? true;

  return (
    <>
      <div className="page-head">
        <p className="eyebrow">Settings</p>
        <h1>Settings</h1>
      </div>

      {/* Her account first (decision 0093): who is signed in, her name, her password, signing out. */}
      <section className="section" aria-labelledby="account-heading">
        <div className="section__head">
          <h2 id="account-heading">Account</h2>
          <p className="hint">Signed in as {user.email ?? 'this account'}.</p>
        </div>
        <ProfileForm name={preferences.name} />
        <details className="disclosure disclosure--link">
          <summary>Change the password</summary>
          <div className="disclosure__panel">
            <PasswordForm />
          </div>
        </details>
        <SignOutForm action={signOut} />
      </section>

      <section className="section" aria-labelledby="notify-heading">
        <div className="section__head">
          <h2 id="notify-heading">Notifications</h2>
        </div>
        <NotificationsSwitch publicKey={publicKey} />
      </section>

      <section className="section" aria-labelledby="people-heading">
        <div className="section__head">
          <h2 id="people-heading">People</h2>
          {!iAmOwner && (
            <p className="hint">
              {owner ? `${personName(owner)}’s workspace.` : 'Another person’s workspace.'}
            </p>
          )}
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
                      ? 'Leave this workspace? You will no longer see its clients and orders.'
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
              Everything, with your pictures, in one file. Keep a copy away from your phone.
            </p>
          </div>
          <div className="btn-row">
            <a href="/api/export" className="btn" download>
              Download everything
            </a>
          </div>
          <TidyForm />
        </section>
      )}
    </>
  );
}
