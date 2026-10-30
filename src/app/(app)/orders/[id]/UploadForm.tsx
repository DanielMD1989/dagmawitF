'use client';

import { useActionState, useRef, useState } from 'react';
import { FormNotice } from '@/components/FormNotice';
import { SubmitButton } from '@/components/SubmitButton';
import { TextField } from '@/components/fields';
import { idle } from '@/lib/action-state';
import {
  ATTACHMENT_GROUP,
  IMAGE_TYPES,
  MAX_PICTURE_SIDE,
  shrunkSize,
  type AttachmentKind,
} from '@/domain/files';
import { uploadAttachment } from './actions';

/** Pictures this small and this size are sent as they are. */
const LEAVE_ALONE_BYTES = 1_500_000;

/**
 * Makes a photo from a phone camera (often 4000 pixels and several megabytes) small enough to send over a mobile
 * connection, and to open quickly on the order page. Returns the file to send: the same one if there is nothing to
 * gain, or if the browser cannot read it (the server then says what is wrong with it).
 */
async function prepare(file: File): Promise<File> {
  if (!(IMAGE_TYPES as readonly string[]).includes(file.type)) return file;
  try {
    const picture = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const size = shrunkSize(picture.width, picture.height, MAX_PICTURE_SIDE);
    const small = size.width === picture.width && size.height === picture.height;
    if (small && file.size <= LEAVE_ALONE_BYTES) {
      picture.close();
      return file;
    }
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d');
    if (!context) return file;
    // A transparent PNG would turn black as a JPEG, so paint the page colour first.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, size.width, size.height);
    context.drawImage(picture, 0, 0, size.width, size.height);
    picture.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], `${file.name.replace(/\.[^.]+$/, '') || 'picture'}.jpg`, { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

/**
 * Adds one picture of a given kind (a sketch, a fitting photo…), behind that kind's own button. Ids carry the kind,
 * as the page has one of these for each.
 */
export function UploadForm({ orderId, kind }: { orderId: string; kind: AttachmentKind }) {
  const [state, action] = useActionState(uploadAttachment, idle);
  const [preparing, setPreparing] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const id = `picture-${kind}`;
  const words = ATTACHMENT_GROUP[kind];

  async function onPick(event: React.ChangeEvent<HTMLInputElement>) {
    const el = event.currentTarget;
    const chosen = el.files?.[0];
    if (!chosen) return;
    setPreparing(true);
    try {
      const ready = await prepare(chosen);
      if (ready !== chosen) {
        const swap = new DataTransfer();
        swap.items.add(ready);
        el.files = swap.files;
      }
    } finally {
      setPreparing(false);
    }
  }

  return (
    <details className="disclosure disclosure--link" open={state.status === 'error' || undefined}>
      <summary>{words.add}</summary>
      <div className="disclosure__panel">
        <form action={action} className="form" noValidate>
          <input type="hidden" name="order-id" value={orderId} />
          <input type="hidden" name="kind" value={kind} />
          <div className="field">
            <label htmlFor={`${id}-file`}>Picture</label>
            <input
              ref={input}
              id={`${id}-file`}
              name="file"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="input"
              onChange={onPick}
              aria-invalid={Boolean(state.errors.file)}
              aria-describedby={state.errors.file ? `${id}-file-hint ${id}-file-error` : `${id}-file-hint`}
            />
            <p id={`${id}-file-hint`} className="hint">
              A photo, or a scan of a sketch. JPEG, PNG or WebP, up to 5 MB. Large photos are made smaller
              first.
            </p>
            {state.errors.file && (
              <p id={`${id}-file-error`} className="error">
                {state.errors.file}
              </p>
            )}
          </div>
          <TextField
            name="caption"
            id={`${id}-caption`}
            label="Caption (optional)"
            state={state}
            maxLength={200}
          />
          <FormNotice state={state} />
          <div className="btn-row">
            <SubmitButton pendingText="Adding…" disabled={preparing}>
              {preparing ? 'Preparing…' : 'Add'}
            </SubmitButton>
          </div>
        </form>
      </div>
    </details>
  );
}
