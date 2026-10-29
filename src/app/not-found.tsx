import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="auth">
      <div className="auth__card card">
        <div className="wordmark">DAGMAWIT</div>
        <h1>Page not found</h1>
        <p className="lede">That page does not exist.</p>
        <div className="btn-row">
          <Link href="/" className="btn">
            Go to My Day
          </Link>
        </div>
      </div>
    </main>
  );
}
