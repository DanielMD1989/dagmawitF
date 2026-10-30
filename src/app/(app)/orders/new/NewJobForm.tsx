'use client';

import { useActionState, useState } from 'react';
import { FormNotice } from '@/components/FormNotice';
import { SubmitButton } from '@/components/SubmitButton';
import { TextArea, TextField } from '@/components/fields';
import { fieldValue, idle } from '@/lib/action-state';
import { JOB_KINDS, KIND_WORDS, isJobKind, type JobKind } from '@/domain/jobs/kinds';
import { pickTemplate } from '@/domain/jobs/templates';
import { NEW_CLIENT, NO_TEMPLATE } from '@/domain/orders/forms';
import { createJob } from '../actions';

export interface TemplateChoice {
  id: string;
  name: string;
  kind: JobKind;
  steps: number;
}

const KIND_HINT: Record<JobKind, string> = {
  new_order: 'Made from the start',
  fix: 'An alteration or repair',
  appointment: 'A client comes in',
  sketch: 'A design to show',
  delivery: 'Already made, to hand over',
};

export function NewJobForm({
  clients,
  initialClient,
  initialKind,
  templates,
  today,
  nextNumber,
  garmentTypes,
}: {
  clients: { id: string; name: string }[];
  initialClient: string | null;
  initialKind: JobKind;
  templates: TemplateChoice[];
  today: string;
  nextNumber: number;
  garmentTypes: string[];
}) {
  const [state, action] = useActionState(createJob, idle);
  const hasClients = clients.length > 0;
  const [pickedClient, setPickedClient] = useState<string | null>(null);
  const client = pickedClient ?? fieldValue(state, 'client', hasClients ? (initialClient ?? '') : NEW_CLIENT);
  const typedKind = fieldValue(state, 'kind', initialKind);
  const [kind, setKind] = useState<JobKind>(isJobKind(typedKind) ? typedKind : initialKind);
  const [garment, setGarment] = useState(fieldValue(state, 'garment-type', ''));
  const [pickedTemplate, setPickedTemplate] = useState<string | null>(null);
  const template = pickedTemplate ?? pickTemplate(templates, kind, garment)?.id ?? NO_TEMPLATE;
  const words = KIND_WORDS[kind];
  const ofKind = templates.filter((t) => t.kind === kind);
  const others = templates.filter((t) => t.kind !== kind);

  return (
    <form action={action} className="form" noValidate>
      <section className="section" aria-labelledby="kind-heading">
        <h2 id="kind-heading">What kind of job</h2>
        <div className="kinds" role="radiogroup" aria-labelledby="kind-heading">
          {JOB_KINDS.map((k) => (
            <label key={k}>
              <input
                type="radio"
                name="kind"
                value={k}
                checked={kind === k}
                onChange={() => {
                  setKind(k);
                  setPickedTemplate(null);
                }}
              />
              <strong>{KIND_WORDS[k].label}</strong>
              <span className="hint">{KIND_HINT[k]}</span>
            </label>
          ))}
        </div>
      </section>

      <section className="section" aria-labelledby="who-heading">
        <h2 id="who-heading">Who it is for</h2>
        {hasClients ? (
          <div className="field">
            <label htmlFor="client">Client</label>
            <select
              id="client"
              name="client"
              className="select"
              value={client}
              onChange={(e) => setPickedClient(e.target.value)}
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
        {client === NEW_CLIENT && (
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

      <section className="section" aria-labelledby="when-heading">
        <h2 id="when-heading">When</h2>
        <div className={words.atTime ? 'form-grid form-grid--pair' : 'form-grid'}>
          <TextField
            name="due-on"
            label={words.dueLabel}
            type="date"
            state={state}
            min={today}
            required
            hint={words.dueHint}
          />
          {words.atTime && <TextField name="time" label="Time (optional)" type="time" state={state} />}
        </div>
      </section>

      <section className="section" aria-labelledby="what-heading">
        <h2 id="what-heading">{words.garment ? 'What you are making' : 'What it is about'}</h2>
        <div className="field">
          <label htmlFor="garment-type">{words.garment ? 'Garment' : 'Garment (optional)'}</label>
          <input
            id="garment-type"
            name="garment-type"
            className="input"
            list="garment-types"
            autoComplete="off"
            maxLength={80}
            value={garment}
            onChange={(e) => setGarment(e.target.value)}
            aria-invalid={Boolean(state.errors['garment-type'])}
            aria-describedby={state.errors['garment-type'] ? 'garment-type-error' : 'garment-type-hint'}
          />
          <p id="garment-type-hint" className="hint">
            For example “Bridal gown” or “Trousers”.
          </p>
          {state.errors['garment-type'] && (
            <p id="garment-type-error" className="error">
              {state.errors['garment-type']}
            </p>
          )}
        </div>
        <datalist id="garment-types">
          {garmentTypes.map((g) => (
            <option key={g} value={g} />
          ))}
        </datalist>
        <TextArea
          name="brief"
          label="Design brief (optional)"
          state={state}
          rows={4}
          maxLength={4000}
          hint="What the client asked for: neckline, sleeves, fabric ideas, the occasion."
        />
      </section>

      <section className="section" aria-labelledby="steps-heading">
        <h2 id="steps-heading">Steps</h2>
        <div className="field">
          <label htmlFor="template">Start with the steps of</label>
          <select
            id="template"
            name="template"
            className="select"
            value={template}
            onChange={(e) => setPickedTemplate(e.target.value)}
            aria-describedby="template-hint"
          >
            {ofKind.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.steps} step{t.steps === 1 ? '' : 's'})
              </option>
            ))}
            {others.length > 0 && (
              <optgroup label="Other templates">
                {others.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.steps} step{t.steps === 1 ? '' : 's'})
                  </option>
                ))}
              </optgroup>
            )}
            <option value={NO_TEMPLATE}>No steps yet: I will add them</option>
          </select>
          <p id="template-hint" className="hint">
            Each step gets a day, counted back from the day above. You can change any of them next.
          </p>
          {state.errors.template && <p className="error">{state.errors.template}</p>}
        </div>
      </section>

      <details className="disclosure disclosure--link">
        <summary>Notes and job number</summary>
        <div className="disclosure__panel">
          <TextArea
            name="notes"
            label="Notes (optional)"
            state={state}
            rows={3}
            maxLength={4000}
            hint="For you. For example: pays in two parts, collects with her mother."
          />
          <TextField
            name="number"
            label="Job number"
            type="number"
            inputMode="numeric"
            min={1}
            state={state}
            placeholder={String(nextNumber)}
            hint={`Leave empty to continue from your highest number. The next one is #${nextNumber}.`}
          />
        </div>
      </details>

      <FormNotice state={state} />
      <div className="btn-row">
        <SubmitButton pendingText="Saving…">Save the job</SubmitButton>
      </div>
    </form>
  );
}
