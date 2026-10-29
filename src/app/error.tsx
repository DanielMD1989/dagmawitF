'use client';

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="auth">
      <div className="auth__card card" role="alert">
        <div className="wordmark">DAGMAWIT</div>
        <h1>Something went wrong</h1>
        <p className="lede">
          Nothing was lost. Try again, and if it keeps happening, tell whoever looks after the app.
        </p>
        {error.digest && <p className="hint">Reference: {error.digest}</p>}
        <div className="btn-row">
          <button type="button" className="btn" onClick={reset}>
            Try again
          </button>
        </div>
      </div>
    </main>
  );
}
