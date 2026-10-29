import type { ActionState } from '@/lib/action-state';

/** The result line under a form. Announced to screen readers; errors interrupt, successes do not. */
export function FormNotice({ state }: { state: ActionState }) {
  if (state.status === 'idle' || !state.message) return null;
  const isError = state.status === 'error';
  return (
    <p className={`notice notice--${state.status}`} role={isError ? 'alert' : 'status'}>
      {state.message}
    </p>
  );
}
