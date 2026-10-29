import type { ActionState } from '@/lib/action-state';
import { fieldTicked, fieldValue } from '@/lib/action-state';

/**
 * The form fields every screen uses, so a label, a hint and an error always sit in the same places and are tied
 * to the field the same way for a screen reader. Each takes the form's `state` and `saved` (what to show when
 * nothing has been refused), and shows what she typed if the form was refused. (docs/architecture.md, rule 1.)
 */

interface Common {
  name: string;
  label: string;
  state: ActionState;
  /** Defaults to the name. Must be unique on the page. */
  id?: string;
  hint?: string;
}

function describedBy(id: string, hint: string | undefined, error: string | undefined): string | undefined {
  const ids = [hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean);
  return ids.length > 0 ? ids.join(' ') : undefined;
}

function Notes({ id, hint, error }: { id: string; hint?: string | undefined; error?: string | undefined }) {
  return (
    <>
      {hint && (
        <p id={`${id}-hint`} className="hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="error">
          {error}
        </p>
      )}
    </>
  );
}

type InputProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'id' | 'name' | 'className' | 'defaultValue' | 'defaultChecked' | 'aria-invalid' | 'aria-describedby'
>;

export function TextField({
  name,
  label,
  state,
  saved = '',
  id = name,
  hint,
  ...rest
}: Common & { saved?: string } & InputProps) {
  const error = state.errors[name];
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        name={name}
        className="input"
        defaultValue={fieldValue(state, name, saved)}
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy(id, hint, error)}
        {...rest}
      />
      <Notes id={id} hint={hint} error={error} />
    </div>
  );
}

export function TextArea({
  name,
  label,
  state,
  saved = '',
  id = name,
  hint,
  rows = 4,
  maxLength,
}: Common & { saved?: string; rows?: number; maxLength?: number }) {
  const error = state.errors[name];
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <textarea
        id={id}
        name={name}
        className="textarea"
        rows={rows}
        maxLength={maxLength}
        defaultValue={fieldValue(state, name, saved)}
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy(id, hint, error)}
      />
      <Notes id={id} hint={hint} error={error} />
    </div>
  );
}

export function SelectField({
  name,
  label,
  state,
  saved = '',
  id = name,
  hint,
  options,
  onChange,
}: Common & {
  saved?: string;
  options: readonly { value: string; label: string }[];
  /** For a form that shows other fields depending on the choice. */
  onChange?: (value: string) => void;
}) {
  const error = state.errors[name];
  const shown = fieldValue(state, name, saved);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {/* React resets a form after each action and ignores a later change of a select's defaultValue, so a
          select that kept its old default would snap back to the value it had when the page opened. A new
          value to show is a new select. */}
      <select
        key={shown}
        id={id}
        name={name}
        className="select"
        defaultValue={shown}
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy(id, hint, error)}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <Notes id={id} hint={hint} error={error} />
    </div>
  );
}

export function CheckField({ name, label, state, saved, id = name, hint }: Common & { saved: boolean }) {
  return (
    <div className="field">
      <label className="check" htmlFor={id}>
        <input
          id={id}
          name={name}
          type="checkbox"
          defaultChecked={fieldTicked(state, name, saved)}
          aria-describedby={describedBy(id, hint, undefined)}
        />
        {label}
      </label>
      <Notes id={id} hint={hint} />
    </div>
  );
}

/** A choice of a few words shown as buttons: centimetres or inches, closed or a shorter day. */
export function ChoiceField({
  name,
  legend,
  state,
  saved,
  options,
  hint,
}: Omit<Common, 'label' | 'id'> & {
  legend: string;
  saved: string;
  options: readonly { value: string; label: string }[];
}) {
  const error = state.errors[name];
  const chosen = fieldValue(state, name, saved);
  return (
    <fieldset className="field" aria-describedby={describedBy(name, hint, error)}>
      <legend>{legend}</legend>
      <div className="segmented">
        {options.map((o) => (
          <label key={o.value}>
            <input type="radio" name={name} value={o.value} defaultChecked={chosen === o.value} />
            {o.label}
          </label>
        ))}
      </div>
      <Notes id={name} hint={hint} error={error} />
    </fieldset>
  );
}
