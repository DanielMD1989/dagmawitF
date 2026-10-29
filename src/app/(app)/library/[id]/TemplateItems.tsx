'use client';

import { useActionState } from 'react';
import { ConfirmAction } from '@/components/ConfirmAction';
import { FormNotice } from '@/components/FormNotice';
import { SubmitButton } from '@/components/SubmitButton';
import { CheckField, SelectField, TextField } from '@/components/fields';
import { idle } from '@/lib/action-state';
import { KIND_LABEL, PREREQUISITE_KINDS, type PrerequisiteKind } from '@/domain/orders/prerequisites';
import { addTemplateItem, removeTemplateItem, saveTemplateItem } from '../actions';

type Item = { id: string; kind: PrerequisiteKind; label: string; blocking: boolean };

/** One thing a garment of this kind waits for. */
export function TemplateItemRow({ item }: { item: Item }) {
  const [state, action] = useActionState(saveTemplateItem, idle);
  const id = `item-${item.id}`;
  return (
    <li className="item">
      <div className="item__head">
        <div className="item__main">
          <span className="item__title">{item.label}</span>
          <span className="hint">
            {KIND_LABEL[item.kind]} · {item.blocking ? 'Holds work back' : 'Reminder'}
          </span>
        </div>
      </div>
      <details className="disclosure disclosure--link">
        <summary>
          Edit<span className="sr-only"> {item.label}</span>
        </summary>
        <div className="disclosure__panel">
          <form action={action} className="form" noValidate>
            <input type="hidden" name="id" value={item.id} />
            <ItemFields state={state} prefix={id} saved={item} />
            <FormNotice state={state} />
            <div className="btn-row">
              <SubmitButton>Save</SubmitButton>
            </div>
          </form>
          <ConfirmAction
            action={removeTemplateItem}
            fields={{ id: item.id }}
            label="Remove"
            question={`Remove “${item.label}” from this template? Tasks stop waiting for it.`}
            confirmLabel="Yes, remove"
          />
        </div>
      </details>
    </li>
  );
}

export function AddTemplateItem({ templateId }: { templateId: string }) {
  const [state, action] = useActionState(addTemplateItem, idle);
  return (
    <details className="disclosure">
      <summary>Add something it waits for</summary>
      <div className="disclosure__panel">
        <form action={action} className="form" noValidate>
          <input type="hidden" name="template-id" value={templateId} />
          <ItemFields state={state} prefix="new-item" saved={null} />
          <FormNotice state={state} />
          <div className="btn-row">
            <SubmitButton pendingText="Adding…">Add</SubmitButton>
          </div>
        </form>
      </div>
    </details>
  );
}

function ItemFields({
  state,
  prefix,
  saved,
}: {
  state: Parameters<typeof TextField>[0]['state'];
  prefix: string;
  saved: Item | null;
}) {
  return (
    <>
      <TextField
        name="label"
        id={`${prefix}-label`}
        label="What is it?"
        state={state}
        saved={saved?.label ?? ''}
        maxLength={120}
        autoComplete="off"
        required
        hint="Use the words of the order’s preparation list, so they are matched: Lace, Main fabric."
      />
      <SelectField
        name="kind"
        id={`${prefix}-kind`}
        label="What kind of thing is it?"
        state={state}
        saved={saved?.kind ?? 'material'}
        options={PREREQUISITE_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }))}
      />
      <CheckField
        name="blocking"
        id={`${prefix}-blocking`}
        label="Work cannot start without it"
        state={state}
        saved={saved?.blocking ?? true}
      />
    </>
  );
}
