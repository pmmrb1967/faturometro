import { describe, expect, it } from 'vitest';
import { shouldLoadWebAnalytics } from './web-analytics';

const HOST = 'app.faturometro.workers.dev';

describe('shouldLoadWebAnalytics', () => {
  it('loads on the landing and privacy pages of the published site', () => {
    expect(shouldLoadWebAnalytics(HOST, '/')).toBe(true);
    expect(shouldLoadWebAnalytics(HOST, '/privacidade')).toBe(true);
  });

  it('does not load on pages with a password field', () => {
    expect(shouldLoadWebAnalytics(HOST, '/entrar')).toBe(false);
    expect(shouldLoadWebAnalytics(HOST, '/criar-conta')).toBe(false);
  });

  it('never loads inside the app', () => {
    expect(shouldLoadWebAnalytics(HOST, '/app')).toBe(false);
    expect(shouldLoadWebAnalytics(HOST, '/app/contratos/123')).toBe(false);
  });

  it('does not load on other hosts', () => {
    expect(shouldLoadWebAnalytics('localhost', '/')).toBe(false);
    expect(shouldLoadWebAnalytics('preview.app.workers.dev', '/')).toBe(false);
  });
});
