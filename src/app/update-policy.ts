/** When a new version of the app is applied (src/app/pwa.ts). */
export type UpdateAction = 'apply' | 'offer' | 'none';

/**
 * Reloading signs out (the key lives only in memory), so inside the app a
 * new version is only offered. Signed out, nothing is lost: it is applied at
 * once, unless a screen that cannot be shown again (the recovery key) holds it.
 */
export function updateAction(state: {
  needRefresh: boolean;
  signedIn: boolean;
  held: boolean;
}): UpdateAction {
  if (!state.needRefresh) return 'none';
  return state.signedIn || state.held ? 'offer' : 'apply';
}
