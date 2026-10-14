/** Where `/app` goes without a session: the guest opens by itself only if it is alone. */
export function entryFor(state: { hasGuest: boolean; accounts: number }): 'guest' | 'login' {
  return state.hasGuest && state.accounts === 0 ? 'guest' : 'login';
}

/** The login page's greeting: by how many accounts this device has (unknown while loading). */
export function loginGreeting(accounts: number | null): 'one' | 'many' | 'none' {
  if (accounts === 0) return 'none';
  return accounts !== null && accounts > 1 ? 'many' : 'one';
}
