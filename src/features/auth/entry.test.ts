import { describe, expect, it } from 'vitest';
import { entryFor } from './entry';

describe('entryFor', () => {
  it('opens the guest only when it is the only profile', () => {
    expect(entryFor({ hasGuest: true, accounts: 0 })).toBe('guest');
  });

  it('asks to sign in when there are accounts, even with a guest', () => {
    expect(entryFor({ hasGuest: true, accounts: 1 })).toBe('login');
  });

  it('asks to sign in with no profiles', () => {
    expect(entryFor({ hasGuest: false, accounts: 0 })).toBe('login');
  });
});
