import { describe, expect, it } from 'vitest';
import { returnAddress } from './cloud-return';

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
