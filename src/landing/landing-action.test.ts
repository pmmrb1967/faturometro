import { describe, expect, it } from 'vitest';
import { landingAction, showsTopSignIn } from './landing-action';

describe('landingAction', () => {
  it('with an open session, only opens the app (never switches to a guest)', () => {
    expect(landingAction({ signedIn: true, hasGuest: false, accounts: 1 })).toBe('open');
    expect(landingAction({ signedIn: true, hasGuest: true, accounts: 0 })).toBe('open');
  });

  it('offers to continue the existing guest', () => {
    expect(landingAction({ signedIn: false, hasGuest: true, accounts: 1 })).toBe('continueGuest');
  });

  it('with accounts and no guest, signing in comes first', () => {
    expect(landingAction({ signedIn: false, hasGuest: false, accounts: 1 })).toBe('signIn');
  });

  it('on a new browser, starts without an account', () => {
    expect(landingAction({ signedIn: false, hasGuest: false, accounts: 0 })).toBe('startGuest');
  });
});

describe('showsTopSignIn', () => {
  it('shows "Entrar" at the top only when the main buttons do not offer it', () => {
    expect(showsTopSignIn('startGuest')).toBe(true);
    expect(showsTopSignIn('continueGuest')).toBe(true);
    expect(showsTopSignIn('signIn')).toBe(false);
    expect(showsTopSignIn('open')).toBe(false);
  });
});
