import type { Metadata } from 'next';
import { SignInForm } from './SignInForm';

export const metadata: Metadata = { title: 'Sign in' };

export default function SignInPage() {
  return (
    <main className="auth">
      <div className="auth__card card">
        <div className="wordmark">DAGMAWIT</div>
        <div className="page-head">
          <h1>Sign in</h1>
          <p className="lede">We email you a code. No password to remember.</p>
        </div>
        <SignInForm />
      </div>
    </main>
  );
}
