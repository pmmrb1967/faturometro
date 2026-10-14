import { describe, expect, it } from 'vitest';
import { isGuest, wrappedKeyOf, type Profile } from './profiles';

const guest: Profile = {
  id: 'g',
  email: '',
  createdAt: '2026-10-14T00:00:00.000Z',
  guestKey: 'AAAA',
};

describe('guest profiles', () => {
  it('tells a guest from an account', () => {
    expect(isGuest(guest)).toBe(true);
    const account: Profile = {
      id: 'a',
      email: 'a@b.pt',
      createdAt: guest.createdAt,
      wrappedKey: {} as never,
    };
    expect(isGuest(account)).toBe(false);
  });

  it('refuses the wrapped key of a guest (sync must never run for it)', () => {
    expect(() => wrappedKeyOf(guest)).toThrow('Profile has no password');
  });
});
