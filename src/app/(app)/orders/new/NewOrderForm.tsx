'use client';

import { useActionState, useState } from 'react';
import { FormNotice } from '@/components/FormNotice';
import { SubmitButton } from '@/components/SubmitButton';
import { TextArea, TextField } from '@/components/fields';
import { fieldValue, idle } from '@/lib/action-state';
import { NEW_CLIENT } from '@/domain/orders/forms';
import { createOrder } from '../actions';

export function NewOrderForm({
  clients,
  initialClient,
  today,
  defaultBufferDays,
  nextNumber,
  garmentTypes,
}: {
  clients: { id: string; name: string }[];
  initialClient: string | null;
  today: string;
  defaultBufferDays: number;
  nextNumber: number;
  garmentTypes: string[];
}) {
  const [state, action] = useActionState(createOrder, idle);
  const hasClients = clients.length > 0;
  const [picked, setPicked] = useState<string | null>(null);
  const choice = picked ?? fieldValue(state, 'client', hasClients ? (initialClient ?? '') : NEW_CLIENT);

  return (
    <form action={action} className="form" noValidate>
      <section className="section" aria-labelledby="who-heading">
        <h2 id="who-heading">Who it is for</h2>
        {hasClients ? (
          <div className="field">
            <label htmlFor="client">Client</label>
            <select
              id="client"
              name="client"
              className="select"
              value={choice}
              onChange={(e) => setPicked(e.target.value)}
              aria-invalid={Boolean(state.errors.client)}
              aria-describedby={state.errors.client ? 'client-error' : undefined}
            >
              <option value="">Choose a client…</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
              <option value={NEW_CLIENT}>+ A new client</option>
            </select>
            {state.errors.client && (
              <p id="client-error" className="error">
                {state.errors.client}
              </p>
            )}
          </div>
        ) : (
          <input type="hidden" name="client" value={NEW_CLIENT} />
        )}
        {choice === NEW_CLIENT && (
          <div className="form-grid form-grid--2">
            <TextField
              name="client-name"
              label="Client's name"
              state={state}
              autoComplete="off"
              maxLength={120}
              required
            />
            <TextField
              name="client-phone"
              label="Phone (optional)"
              state={state}
              type="tel"
              inputMode="tel"
              autoComplete="off"
              maxLength={30}
            />
          </div>
        )}
      </section>

      <section className="section" aria-labelledby="what-heading">
        <h2 id="what-heading">What is being made</h2>
        <TextField
          name="garment-type"
          label="Garment"
          state={state}
          list="garment-types"
          autoComplete="off"
          maxLength={80}
          required
          hint="For example “Bridal gown” or “Suit alteration”. More garments can be added to the order afterwards."
        />
        <datalist id="garment-types">
          {garmentTypes.map((g) => (
            <option key={g} value={g} />
          ))}
        </datalist>
        <TextArea
          name="brief"
          label="Design brief (optional)"
          state={state}
          rows={5}
          maxLength={4000}
          hint="What the client asked for: neckline, sleeves, fabric ideas, the occasion, anything she said."
        />
      </section>

      <section className="section" aria-labelledby="when-heading">
        <h2 id="when-heading">When</h2>
        <div className="form-grid form-grid--2">
          <TextField
            name="delivery-on"
            label="Handover day"
            type="date"
            state={state}
            min={today}
            required
            hint="The day the client collects it. This is the promise."
          />
          <TextField
            name="buffer-days"
            label="Days to keep free before it"
            type="number"
            inputMode="numeric"
            min={0}
            max={30}
            state={state}
            placeholder={String(defaultBufferDays)}
            hint={`A safety margin. Leave empty for your usual ${defaultBufferDays}.`}
          />
        </div>
      </section>

      <section className="section" aria-labelledby="more-heading">
        <h2 id="more-heading">Anything else</h2>
        <TextArea
          name="notes"
          label="Notes (optional)"
          state={state}
          rows={3}
          maxLength={4000}
          hint="For you. For example: pays in two parts, collects with her mother."
        />
        <details className="disclosure disclosure--link">
          <summary>Use my own order number</summary>
          <div className="disclosure__panel">
            <TextField
              name="number"
              label="Order number"
              type="number"
              inputMode="numeric"
              min={1}
              state={state}
              placeholder={String(nextNumber)}
              hint={`Leave empty to continue from your highest number. The next one is #${nextNumber}.`}
            />
          </div>
        </details>
      </section>

      {state.errors.form && (
        <p className="error" role="alert">
          {state.errors.form}
        </p>
      )}
      <FormNotice state={state} />
      <div className="btn-row">
        <SubmitButton name="intent" value="confirm" pendingText="Confirming…">
          Confirm order
        </SubmitButton>
        <SubmitButton name="intent" value="draft" className="btn btn--quiet" pendingText="Saving…">
          Save as draft
        </SubmitButton>
      </div>
      <p className="hint">
        A confirmed order is a promise: the planner makes room for it. A draft promises nothing and takes none
        of her time until it is confirmed.
      </p>
    </form>
  );
}
