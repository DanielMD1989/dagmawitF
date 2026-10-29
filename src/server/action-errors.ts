import 'server-only';
import { failure, type ActionState } from '@/lib/action-state';
import { ruleMessage } from '@/lib/database-errors';

/**
 * For a failure we did not expect (the database is down, a rule we did not foresee).
 * The details go to the server log; she sees a plain message that says nothing was changed,
 * and her input stays in the form so she can simply try again.
 */
export function unexpected(
  what: string,
  error: { code?: string; message: string },
  typed: Record<string, string>,
): ActionState {
  console.error(`Saving ${what} failed [${error.code ?? 'no code'}]: ${error.message}`);
  return failure(`Could not save ${what}. Nothing was changed. Try again in a moment.`, {}, typed);
}

/**
 * For a refusal from the database. One of its own rules (a delivered order cannot be changed) is shown as it
 * is written, because it is written for her. Anything else is unexpected.
 */
export function saveFailed(
  what: string,
  error: { code?: string; message: string },
  typed: Record<string, string>,
): ActionState {
  const rule = ruleMessage(error);
  return rule ? failure(rule, {}, typed) : unexpected(what, error, typed);
}

/** The change matched nothing: it was removed in another window, or it was never hers. */
export function missing(what: string, typed: Record<string, string>): ActionState {
  return failure(`That ${what} could not be found. It may have been removed. Reload the page.`, {}, typed);
}
