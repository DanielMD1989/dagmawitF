'use client';

import { useActionState } from 'react';
import { ConfirmAction } from '@/components/ConfirmAction';
import { FormNotice } from '@/components/FormNotice';
import { SubmitButton } from '@/components/SubmitButton';
import { TextField } from '@/components/fields';
import { idle } from '@/lib/action-state';
import { ATTACHMENT_KIND_LABEL, type AttachmentKind } from '@/domain/files';
import { removeAttachment, saveAttachmentCaption } from './actions';

/** One sketch or photo. It opens full size in a new tab; the file itself is never linked to directly. */
export function PhotoCard({
  picture,
  editable,
}: {
  picture: { id: string; kind: AttachmentKind; version: number; caption: string };
  editable: boolean;
}) {
  const [state, action] = useActionState(saveAttachmentCaption, idle);
  const name = `${ATTACHMENT_KIND_LABEL[picture.kind]} ${picture.version}`;
  return (
    <li className="photo">
      <a className="photo__img" href={`/files/${picture.id}`} target="_blank" rel="noopener noreferrer">
        {/* A private picture reached through our own address, which redirects for one minute: not a file next/image can optimise. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/files/${picture.id}`}
          alt={picture.caption ? `${name}: ${picture.caption}` : name}
          loading="lazy"
        />
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
      <div className="photo__body">
        <span className="photo__name">{name}</span>
        {picture.caption && <span className="hint">{picture.caption}</span>}
        {editable && (
          <details className="disclosure disclosure--link">
            <summary>
              Edit<span className="sr-only"> {name}</span>
            </summary>
            <div className="disclosure__panel">
              <form action={action} className="form" noValidate>
                <input type="hidden" name="id" value={picture.id} />
                <TextField
                  name="caption"
                  id={`caption-${picture.id}`}
                  label="Caption"
                  state={state}
                  saved={picture.caption}
                  maxLength={200}
                />
                <FormNotice state={state} />
                <div className="btn-row">
                  <SubmitButton>Save caption</SubmitButton>
                </div>
              </form>
              <ConfirmAction
                action={removeAttachment}
                fields={{ id: picture.id }}
                label="Remove picture"
                question={`Remove ${name}?`}
                confirmLabel="Yes, remove"
              />
            </div>
          </details>
        )}
      </div>
    </li>
  );
}
