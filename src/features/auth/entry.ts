/** Where `/app` goes without a session: the guest opens by itself only if it is alone. */
export function entryFor(state: { hasGuest: boolean; accounts: number }): 'guest' | 'login' {
  return state.hasGuest && state.accounts === 0 ? 'guest' : 'login';
}

/**
 * Where a page of the app sends a visitor who has to sign in. The app's front door
 * (`/app`, which older installs still open) goes to the landing page, which offers
 * the right next step; any other page goes to /entrar.
 */
export function signInRoute(pathname: string): '/' | '/entrar' {
  return pathname === '/app' || pathname === '/app/' ? '/' : '/entrar';
}

/**
 * Where signing in lands: always the start page, whatever page the user left,
 * unless files shared to the app are waiting on the invoices page that reads them.
 */
export function afterSignIn(sharedFiles: number): '/app' | '/app/faturas' {
  return sharedFiles > 0 ? '/app/faturas' : '/app';
}

/** The login page's greeting: by how many accounts this device has (unknown while loading). */
export function loginGreeting(accounts: number | null): 'one' | 'many' | 'none' {
  if (accounts === 0) return 'none';
  return accounts !== null && accounts > 1 ? 'many' : 'one';
}
