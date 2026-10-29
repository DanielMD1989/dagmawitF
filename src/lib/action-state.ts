/** What a form action tells its form. Safe to import from client components. */
export interface ActionState {
  status: 'idle' | 'success' | 'error';
  message: string;
  /** Messages keyed by field name, shown next to the field. */
  errors: Record<string, string>;
  /**
   * What she typed, sent back when the action refuses it, so the form shows her own input
   * again. React empties a form once its action finishes, so without this a refused form would
   * wipe everything she had entered. `null` means "nothing to give back": show the saved values.
   * A field that is absent here was empty, or an unticked box.
   */
  values: Record<string, string> | null;
}

export const idle: ActionState = { status: 'idle', message: '', errors: {}, values: null };

export function success(message: string): ActionState {
  return { status: 'success', message, errors: {}, values: null };
}

/** Every text field of a submitted form, to hand back with a refusal. Files are never echoed. */
export function typedIn(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [name, value] of formData.entries()) {
    if (typeof value === 'string') values[name] = value;
  }
  return values;
}

/**
 * Pass `typedIn(formData)` whenever the action refuses her input, so she can correct it
 * rather than start again.
 */
export function failure(
  message: string,
  errors: Record<string, string> = {},
  values: Record<string, string> | null = null,
): ActionState {
  return { status: 'error', message, errors, values };
}

/** The value a text field should show: what she typed if the form was refused, else the saved one. */
export function fieldValue(state: ActionState, name: string, saved: string): string {
  return state.values ? (state.values[name] ?? '') : saved;
}

/** Whether a checkbox should be ticked: as she left it if the form was refused, else as saved. */
export function fieldTicked(state: ActionState, name: string, saved: boolean): boolean {
  return state.values ? state.values[name] === 'on' : saved;
}
