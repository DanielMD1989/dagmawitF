'use client';

import { useEffect, useRef, useState } from 'react';

export function Chevron() {
  return (
    <svg
      className="chevron"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

/**
 * A row that opens a sheet from the bottom of the screen (decision 0105), as a phone's own apps do: what can be done
 * with the thing is there, not in links scattered under it. A native dialog: it holds the focus while open, Escape or
 * a tap outside closes it, and focus goes back to the row. A form marked `data-closes` closes it once sent. What is in
 * it is made when it opens, so a long list of rows does not carry every row's forms.
 */
export function Sheet({
  title,
  opener,
  openerClass,
  openerLabel,
  chevron = true,
  children,
}: {
  /** The sheet's heading, and its name for a screen reader. */
  title: string;
  /** What the row shows: phrasing content only (it is inside a button). */
  opener: React.ReactNode;
  openerClass: string;
  /** The row's name for a screen reader, when what it shows does not say it. */
  openerLabel?: string;
  /** A row opens with an arrow; a round button (⋯) does not. */
  chevron?: boolean;
  children: React.ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const close = () => dialog.current?.close();
  return (
    <>
      <button
        type="button"
        className={openerClass}
        aria-haspopup="dialog"
        aria-label={openerLabel}
        onClick={() => {
          setOpen(true);
          dialog.current?.showModal();
        }}
      >
        {opener}
        {chevron && <Chevron />}
      </button>
      <dialog
        ref={dialog}
        className="sheet"
        aria-label={title}
        onClose={() => setOpen(false)}
        // A tap on the dimmed page around the sheet lands on the dialog itself: it closes.
        onClick={(e) => {
          if (e.target === dialog.current) close();
        }}
        onSubmit={(e) => {
          if ((e.target as HTMLFormElement).dataset.closes !== undefined) setTimeout(close, 0);
        }}
      >
        {open && (
          <div className="sheet__body">
            <div className="sheet__grab" aria-hidden="true" />
            <div className="sheet__head">
              <h2 className="sheet__title">{title}</h2>
              <button type="button" className="sheet__close" aria-label="Close" onClick={close}>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.6"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </div>
            {children}
          </div>
        )}
      </dialog>
    </>
  );
}

/**
 * Closes the sheet a form is in once it is saved (decision 0105): the change shows on the page under it. A refused
 * save keeps it open, with what to fix.
 */
export function useCloseOnSaved(form: React.RefObject<HTMLElement | null>, state: { status: string }): void {
  useEffect(() => {
    if (state.status === 'success') form.current?.closest('dialog')?.close();
  }, [form, state]);
}
