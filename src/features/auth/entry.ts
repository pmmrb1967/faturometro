/** Where `/app` goes without a session: the guest opens by itself only if it is alone. */
export function entryFor(state: { hasGuest: boolean; accounts: number }): 'guest' | 'login' {
  return state.hasGuest && state.accounts === 0 ? 'guest' : 'login';
}
