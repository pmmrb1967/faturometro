import { describe, expect, it } from 'vitest';
import { AUTH_REDIRECT_PATH, contentSecurityPolicy, headersFile } from '../../security-headers.ts';

const SYNC = 'https://sync.test';

function directive(csp: string, name: string): string[] {
  const found = csp.split('; ').find((part) => part.startsWith(`${name} `));
  return found ? found.split(' ').slice(1) : [];
}

describe('security headers', () => {
  it('lets the app reach Microsoft sign-in and the OneDrive app folder', () => {
    const connect = directive(contentSecurityPolicy(SYNC), 'connect-src');
    expect(connect).toContain('https://login.microsoftonline.com');
    expect(connect).toContain('https://graph.microsoft.com');
    expect(connect).toContain(SYNC);
    // The silent renewal frame goes to Microsoft and comes back to the app's own page.
    expect(directive(contentSecurityPolicy(SYNC), 'frame-src')).toEqual([
      "'self'",
      'https://login.microsoftonline.com',
    ]);
  });

  it('keeps every page unframeable except the sign-in return page, framed by the app only', () => {
    const file = headersFile(SYNC);
    const [general = '', ...rest] = file.split(`\n${AUTH_REDIRECT_PATH}\n`);
    expect(directive(contentSecurityPolicy(SYNC), 'frame-ancestors')).toEqual(["'none'"]);
    expect(general).toContain('X-Frame-Options: DENY');
    const redirect = rest.join('');
    expect(redirect).toContain('! Content-Security-Policy');
    expect(redirect).toContain('! X-Frame-Options');
    expect(redirect).toContain("frame-ancestors 'self'");
    expect(redirect).not.toContain("frame-ancestors 'none'");
  });
});
