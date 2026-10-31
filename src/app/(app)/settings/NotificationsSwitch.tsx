'use client';

import { useEffect, useState } from 'react';
import { dropPushSubscription, hasPushSubscription, savePushSubscription } from './actions';

type State = 'checking' | 'unsupported' | 'blocked' | 'off' | 'on' | 'working' | 'failed';

/** "VAPID" keys travel as base64url; the browser wants the bytes. */
function bytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64url
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(base64url.length / 4) * 4, '=');
  const raw = atob(base64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * Settings → Notifications: this phone gets a notification when someone else of the workspace changes something
 * (decision 0083). Per phone: each phone is turned on by itself.
 */
export function NotificationsSwitch({ publicKey }: { publicKey: string | null }) {
  const [state, setState] = useState<State>('checking');

  useEffect(() => {
    let gone = false;
    (async () => {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window))
        return setState('unsupported');
      if (Notification.permission === 'denied') return setState('blocked');
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      const on = subscription ? await hasPushSubscription(subscription.endpoint) : false;
      if (!gone) setState(on ? 'on' : 'off');
    })().catch(() => !gone && setState('failed'));
    return () => {
      gone = true;
    };
  }, []);

  async function turnOn() {
    if (!publicKey) return;
    setState('working');
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return setState(permission === 'denied' ? 'blocked' : 'off');
      const registration = await navigator.serviceWorker.ready;
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: bytes(publicKey),
        }));
      const saved = await savePushSubscription(subscription.toJSON());
      setState(saved.ok ? 'on' : 'failed');
    } catch {
      setState('failed');
    }
  }

  async function turnOff() {
    setState('working');
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await dropPushSubscription(subscription.endpoint);
        await subscription.unsubscribe();
      }
      setState('off');
    } catch {
      setState('failed');
    }
  }

  if (!publicKey) return <p className="hint">Notifications are being set up. Check back in a few minutes.</p>;
  if (state === 'checking') return <p className="hint">Checking this phone…</p>;
  if (state === 'unsupported')
    return (
      <p className="hint">
        This browser cannot show notifications. On an iPhone, first add the app to the Home Screen (Share →
        Add to Home Screen), open it from there, then come back here.
      </p>
    );
  if (state === 'blocked')
    return (
      <p className="hint">
        Notifications are blocked for this app in the phone’s settings. Allow them there, then come back here.
      </p>
    );
  return (
    <div className="form">
      <p role="status" className="hint">
        {state === 'on' && 'On for this phone: you are told when someone else changes a job.'}
        {state === 'off' && 'Off for this phone.'}
        {state === 'working' && 'One moment…'}
        {state === 'failed' && 'That did not work. Try again.'}
      </p>
      <div className="btn-row">
        {state === 'on' ? (
          <button type="button" className="btn btn--quiet" onClick={turnOff}>
            Turn off on this phone
          </button>
        ) : (
          <button type="button" className="btn" onClick={turnOn} disabled={state === 'working'}>
            Turn on notifications on this phone
          </button>
        )}
      </div>
    </div>
  );
}
