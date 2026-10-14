import {
  useState,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import { t } from '../i18n/pt-PT';
import './forms.css';

interface FieldShellProps {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: (describedBy: string | undefined) => ReactNode;
}

function FieldShell({ id, label, hint, error, children }: FieldShellProps) {
  const describedBy = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ');
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children(describedBy || undefined)}
      {hint && (
        <p id={`${id}-hint`} className="field-hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  id: string;
  label: string;
  hint?: string;
  error?: string;
}

export function Field({ id, label, hint, error, ...input }: FieldProps) {
  return (
    <FieldShell id={id} label={label} hint={hint} error={error}>
      {(describedBy) => {
        const props = {
          id,
          'aria-invalid': error ? true : undefined,
          'aria-describedby': describedBy,
          ...input,
        };
        return input.type === 'password' ? <PasswordInput {...props} /> : <input {...props} />;
      }}
    </FieldShell>
  );
}

/** Password input with a button to show or hide what was typed. */
export function PasswordInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const [shown, setShown] = useState(false);
  return (
    <div className="password-input">
      <input {...props} type={shown ? 'text' : 'password'} />
      <button
        type="button"
        className="password-toggle"
        aria-label={shown ? t.password.hide : t.password.show}
        title={shown ? t.password.hide : t.password.show}
        aria-pressed={shown}
        aria-controls={props.id}
        onClick={() => setShown(!shown)}
      >
        <EyeIcon crossed={shown} />
      </button>
    </div>
  );
}

function EyeIcon({ crossed }: { crossed: boolean }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
      {crossed && <path d="M4 4l16 16" />}
    </svg>
  );
}

interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}

export function SelectField({ id, label, hint, error, children, ...select }: SelectFieldProps) {
  return (
    <FieldShell id={id} label={label} hint={hint} error={error}>
      {(describedBy) => (
        <select
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          {...select}
        >
          {children}
        </select>
      )}
    </FieldShell>
  );
}
