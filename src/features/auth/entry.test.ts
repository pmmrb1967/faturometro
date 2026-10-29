import { describe, expect, it } from 'vitest';
import { entryFor, loginGreeting, signInRoute } from './entry';

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

describe('loginGreeting', () => {
  it('greets returning users and explains local accounts to new ones', () => {
    expect(loginGreeting(1)).toBe('one');
    expect(loginGreeting(3)).toBe('many');
    expect(loginGreeting(0)).toBe('none');
    // While loading, assume the usual case (one account) to avoid a flicker.
    expect(loginGreeting(null)).toBe('one');
  });
});

describe('signInRoute', () => {
  it('sends the front door of the app to the landing page', () => {
    expect(signInRoute('/app')).toBe('/');
    expect(signInRoute('/app/')).toBe('/');
  });

  it('sends any other page to the login page', () => {
    expect(signInRoute('/app/mes')).toBe('/entrar');
    expect(signInRoute('/app/partilhar')).toBe('/entrar');
  });
});
