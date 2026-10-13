import { z } from 'zod';
import { t } from '../../i18n/pt-PT';

export const MIN_PASSWORD_LENGTH = 10;

export type FieldErrors<K extends string> = Partial<Record<K, string>>;

const email = z.string().trim().pipe(z.email());

export function validateEmail(value: string): string | undefined {
  return email.safeParse(value).success ? undefined : t.auth.errors.email;
}

export function validateNewPassword(password: string, confirm: string) {
  const errors: FieldErrors<'password' | 'confirm'> = {};
  if (password.length < MIN_PASSWORD_LENGTH) errors.password = t.auth.errors.passwordShort;
  else if (password !== confirm) errors.confirm = t.auth.errors.passwordMismatch;
  return errors;
}

export function validateRegister(values: { email: string; password: string; confirm: string }) {
  const errors: FieldErrors<'email' | 'password' | 'confirm'> = {
    ...validateNewPassword(values.password, values.confirm),
  };
  const emailError = validateEmail(values.email);
  if (emailError) errors.email = emailError;
  return errors;
}

export function required(value: string): string | undefined {
  return value.trim() ? undefined : t.auth.errors.required;
}
