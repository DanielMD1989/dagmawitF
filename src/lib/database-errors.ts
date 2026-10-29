/**
 * Reading what the database says when it refuses a change. Safe to import anywhere.
 *
 * The database raises two kinds of refusal. Its own rules (an order needs a garment before it is confirmed, a
 * delivered order cannot be changed) are written as plain sentences. Everything else (a table's check, a key
 * that is already taken) names a constraint and is meant for developers. A screen turns the first kind into a
 * message and handles the second by naming the constraint it expects.
 */

export interface DatabaseError {
  code?: string;
  message: string;
}

/** The name of the constraint a refusal is about: orders_number_key, orders_client_fk, and so on. */
export function constraintOf(error: DatabaseError): string | null {
  return /constraint "([^"]+)"/.exec(error.message)?.[1] ?? null;
}

/** Whether a refusal is about the named constraint. A missing error is never a violation. */
export function violates(error: DatabaseError | null, constraint: string): boolean {
  return error !== null && constraintOf(error) === constraint;
}

/**
 * The sentence for one of the database's own rules, or null if the refusal is anything else. Rules are raised
 * with the check-violation code and a message that does not mention a constraint.
 */
export function ruleMessage(error: DatabaseError): string | null {
  if (error.code !== '23514' || constraintOf(error) !== null) return null;
  const sentence = error.message.trim().replace(/[.;:,\s]+$/, '');
  if (sentence === '') return null;
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}
