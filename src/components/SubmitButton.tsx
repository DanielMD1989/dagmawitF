'use client';

import { useFormStatus } from 'react-dom';

/**
 * A form's save button. While the form is being sent every button on it is disabled, and the one that was
 * pressed says what is happening (a form with two buttons, such as "Confirm order" and "Save as draft", names
 * and values them so the action knows which one it was).
 */
export function SubmitButton({
  children,
  pendingText = 'Saving…',
  className = 'btn',
  name,
  value,
  disabled = false,
  ...rest
}: {
  children: React.ReactNode;
  pendingText?: string;
  className?: string;
  name?: string;
  value?: string;
} & Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  'type' | 'className' | 'children' | 'name' | 'value'
>) {
  const { pending, data } = useFormStatus();
  const pressed = pending && (name === undefined || data?.get(name) === value);
  return (
    <button
      type="submit"
      className={className}
      disabled={pending || disabled}
      name={name}
      value={value}
      {...rest}
    >
      {pressed ? pendingText : children}
    </button>
  );
}
