import { describe, expect, it } from 'vitest';
import { submittedPassword } from './submitted-password';

/** A submit event of a form whose password field holds `inField`. */
function submitOf(inField: string | null) {
  return {
    currentTarget: {
      querySelector: (selector: string) =>
        inField !== null && selector.includes('current-password') ? { value: inField } : null,
    },
  } as unknown as Parameters<typeof submittedPassword>[0];
}

describe('the password a form sends', () => {
  it('is what the person typed', () => {
    expect(submittedPassword(submitOf('typed'), 'typed')).toBe('typed');
  });

  it('is what the browser filled in when the page was never told about it', () => {
    // Chrome autofill: the field shows the saved password, the change event has not come.
    expect(submittedPassword(submitOf('saved-password'), '')).toBe('saved-password');
  });

  it('is empty when the field is empty', () => {
    expect(submittedPassword(submitOf(''), '')).toBe('');
    expect(submittedPassword(submitOf(null), '')).toBe('');
  });
});
