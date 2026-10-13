import { describe, expect, it } from 'vitest';
import { validateEmail, validateRegister } from './validation';

describe('auth validation', () => {
  it('accepts a valid registration', () => {
    expect(
      validateRegister({
        email: ' ana@example.pt ',
        password: '0123456789',
        confirm: '0123456789',
      }),
    ).toEqual({});
  });

  it('reports each problem on its field', () => {
    expect(validateRegister({ email: 'ana', password: 'curta', confirm: 'curta' })).toEqual({
      email: expect.any(String),
      password: expect.any(String),
    });
    expect(
      validateRegister({ email: 'ana@example.pt', password: '0123456789', confirm: '012345678X' }),
    ).toEqual({ confirm: expect.any(String) });
  });

  it('validates emails', () => {
    expect(validateEmail('ana@example.pt')).toBeUndefined();
    expect(validateEmail('ana@')).toBeDefined();
  });
});
