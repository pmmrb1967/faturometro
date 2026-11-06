import { describe, expect, it } from 'vitest';
import { maskApiKey } from './key-mask';

describe('maskApiKey', () => {
  it('shows only the kind of key and its last 4 characters', () => {
    // Made-up key.
    expect(maskApiKey('sk-ant-api03-abcdefghijklmnopqrstuvwxyz-WXYZ')).toBe('sk-ant-…WXYZ');
  });

  it('without the usual prefix, only the last 4', () => {
    expect(maskApiKey('  abcdefghijkl1234 ')).toBe('…1234');
  });

  it('never shows a short key whole', () => {
    expect(maskApiKey('abcd')).toBe('…');
    expect(maskApiKey('sk-ant-12345')).toBe('…');
  });
});
