export type LandingAction = 'open' | 'continueGuest' | 'signIn' | 'startGuest';

/**
 * The landing page's main button. An open session is never swapped for a guest, and a
 * browser with accounts but no guest shows signing in first (a new guest would look empty).
 */
export function landingAction(state: {
  signedIn: boolean;
  hasGuest: boolean;
  accounts: number;
}): LandingAction {
  if (state.signedIn) return 'open';
  if (state.hasGuest) return 'continueGuest';
  return state.accounts > 0 ? 'signIn' : 'startGuest';
}

/** The top bar's "Entrar", only when the main buttons do not already offer it or an open app. */
export function showsTopSignIn(action: LandingAction): boolean {
  return action === 'startGuest' || action === 'continueGuest';
}
