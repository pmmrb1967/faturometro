import { describe, expect, it } from 'vitest';
import { backToSettings, returnAddress } from './cloud-return';

describe('the address after a cloud sign-in', () => {
  it('goes back to the page that left', () => {
    expect(
      returnAddress({
        error: 'access_denied',
        provider: 'dropbox',
        intent: 'enable',
        returnTo: '/app/definicoes',
      }),
    ).toBe('/app/definicoes');
  });

  it('goes to the synced sign-in page when this tab lost what it was doing', () => {
    // The return opened where sessionStorage is gone (another tab, an installed app on iPhone).
    expect(returnAddress({ error: 'no_pending' })).toBe('/entrar-sincronizado');
  });
});

describe('a sign-in that came back to the settings page', () => {
  it('is one the settings page started (turn on, sign in again, move from the server)', () => {
    for (const intent of ['enable', 'reconnect', 'migrate']) {
      expect(backToSettings({ provider: 'gdrive', intent, accountId: 'a' })).toBe(true);
      expect(backToSettings({ provider: 'dropbox', intent, error: 'access_denied' })).toBe(true);
    }
  });

  it('is not the synced sign-in page, nor one this tab lost', () => {
    expect(backToSettings({ provider: 'gdrive', intent: 'connect', accountId: 'a' })).toBe(false);
    expect(backToSettings({ lost: true })).toBe(false);
    expect(backToSettings(null)).toBe(false);
  });
});
