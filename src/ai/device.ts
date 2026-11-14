/**
 * A random id of this device, only to count the free AI's readings of the day
 * (as in Prazómetro). Not synced and not tied to the account; the server keeps
 * only sha256(day + id), which changes every day.
 */
const STORAGE_KEY = 'faturometro.device';
const VALID = /^[A-Za-z0-9_-]{16,64}$/;
let sessionId: string | undefined;

function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function deviceId(): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && VALID.test(saved)) return saved;
  } catch {
    // No storage: the id lasts while the page is open.
  }
  sessionId ??= randomId();
  try {
    localStorage.setItem(STORAGE_KEY, sessionId);
  } catch {
    // Same.
  }
  return sessionId;
}
