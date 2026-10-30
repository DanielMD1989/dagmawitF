/**
 * Shown the moment she taps a link, while the next page is fetched (decision 0077): the tap answers at once, and the
 * shape of a page appears where its content will be, instead of the old page staying still as if nothing happened.
 */
export default function Loading() {
  return (
    <div className="loading" role="status" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div className="loading__line loading__line--short" aria-hidden="true" />
      <div className="loading__line loading__line--title" aria-hidden="true" />
      <div className="loading__card" aria-hidden="true" />
      <div className="loading__card" aria-hidden="true" />
      <div className="loading__card" aria-hidden="true" />
    </div>
  );
}
