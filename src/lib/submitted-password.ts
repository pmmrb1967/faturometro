import type { FormEvent } from 'react';

/**
 * The account password a form sends: what React saw typed, or else what is in the
 * field. Browsers fill saved passwords without telling the page until the person
 * interacts with it (Chrome), so a form must not wait on its state to allow sending.
 */
export function submittedPassword(event: FormEvent, typed: string): string {
  if (typed) return typed;
  const field = event.currentTarget.querySelector<HTMLInputElement>(
    'input[autocomplete="current-password"]',
  );
  return field?.value ?? '';
}
