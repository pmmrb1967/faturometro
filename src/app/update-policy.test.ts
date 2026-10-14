import { describe, expect, it } from 'vitest';
import { updateAction } from './update-policy';

describe('updateAction', () => {
  it('does nothing without a new version', () => {
    expect(updateAction({ needRefresh: false, signedIn: false, held: false })).toBe('none');
  });

  it('applies at once when no one is signed in (nothing in memory is lost)', () => {
    expect(updateAction({ needRefresh: true, signedIn: false, held: false })).toBe('apply');
  });

  it('only offers it inside the app, where reloading signs out', () => {
    expect(updateAction({ needRefresh: true, signedIn: true, held: false })).toBe('offer');
  });

  it('waits while a one-time screen (the recovery key) is shown', () => {
    expect(updateAction({ needRefresh: true, signedIn: false, held: true })).toBe('offer');
  });
});
