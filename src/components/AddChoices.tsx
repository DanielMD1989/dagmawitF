'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Chevron } from '@/components/Sheet';
import { AddStep } from '@/components/steps/AddStepForm';

const ICONS = {
  order: (
    // A hanger: something made for a client.
    <path d="M12 7a2 2 0 1 1 2-2 M12 7v2 M12 9 3.5 16a1.6 1.6 0 0 0 1 2.9h15a1.6 1.6 0 0 0 1-2.9Z" />
  ),
  event: (
    <>
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M4 10h16 M8 3v4 M16 3v4 M12 13l1.1 2.2 2.4.3-1.8 1.7.5 2.3-2.2-1.2-2.2 1.2.5-2.3-1.8-1.7 2.4-.3Z" />
    </>
  ),
  own: <path d="M5 12.5l4.5 4.5L19 7.5" />,
} as const;

function Choice({ icon, title, sub }: { icon: keyof typeof ICONS; title: string; sub: string }) {
  return (
    <>
      <span className="add-choice__icon" aria-hidden="true">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {ICONS[icon]}
        </svg>
      </span>
      <span className="add-choice__words">
        <span className="add-choice__title">{title}</span>
        <span className="add-choice__sub">{sub}</span>
      </span>
      <Chevron />
    </>
  );
}

/**
 * What Today's "+" offers (decision 0108): an order, an event, or something of her own, each with a picture and a
 * line saying what it is. Something of her own is added right here: its form takes the sheet's place, with a way back.
 */
export function AddChoices({ today }: { today: string }) {
  const [own, setOwn] = useState(false);
  if (own)
    return (
      <div className="add-own">
        <button type="button" className="add-own__back" onClick={() => setOwn(false)}>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="m15 18-6-6 6-6" />
          </svg>
          Back
        </button>
        <h3 className="add-own__title">For yourself</h3>
        <AddStep
          orderId={null}
          day={today}
          idPrefix="own"
          titleLabel="What to do"
          placeholder="Call the lace supplier…"
        />
      </div>
    );
  return (
    <ul className="add-choices">
      <li>
        <Link href="/orders/new" className="add-choice">
          <Choice icon="order" title="Order" sub="For a client, with its steps" />
        </Link>
      </li>
      <li>
        <Link href="/orders/new?event=1" className="add-choice">
          <Choice icon="event" title="Event" sub="A bazaar or a show, and what to prepare" />
        </Link>
      </li>
      <li>
        <button type="button" className="add-choice" onClick={() => setOwn(true)}>
          <Choice icon="own" title="For yourself" sub="A task of your own, on a day" />
        </button>
      </li>
    </ul>
  );
}
