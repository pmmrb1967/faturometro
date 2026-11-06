/** Shortest key shown with its last characters: shorter ones would show too much of it. */
const MIN_LENGTH = 16;
const VISIBLE = 4;
const PREFIX = 'sk-ant-';

/**
 * A saved API key as shown in Settings: never whole, only its kind and last
 * 4 characters ("sk-ant-…WXYZ"), enough to tell which key it is.
 */
export function maskApiKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length < MIN_LENGTH) return '…';
  const prefix = trimmed.startsWith(PREFIX) ? PREFIX : '';
  return `${prefix}…${trimmed.slice(-VISIBLE)}`;
}
