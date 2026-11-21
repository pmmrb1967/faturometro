import { BEACON_REPORT_ORIGIN, BEACON_SCRIPT_ORIGIN } from './src/app/web-analytics-config.ts';

/**
 * Security headers of the published app (PLAN.md §11), written to
 * dist/_headers at build time; Cloudflare's static assets serve them.
 *
 * The app may only connect to itself, the Anthropic and Google Gemini APIs
 * (AI, with the user's key), the sync server (also the free AI) and
 * Cloudflare Web Analytics (public pages only, src/app/web-analytics.ts),
 * and, only once the user links OneDrive, Microsoft sign-in and Graph (the
 * app's own folder) and the hosts OneDrive downloads files from.
 * 'wasm-unsafe-eval' lets the QR reader's WebAssembly run; it does not allow
 * eval() of JavaScript.
 */
/** Where Microsoft sign-in comes back to (src/cloud/auth-redirect.ts). */
export const AUTH_REDIRECT_PATH = '/auth-redirect.html';

const MICROSOFT_LOGIN = 'https://login.microsoftonline.com';
/** Graph, and the hosts its download links point to (personal and work OneDrive). */
const ONEDRIVE_ORIGINS = [
  'https://graph.microsoft.com',
  'https://*.files.1drv.com',
  'https://*.livefilestore.com',
  'https://my.microsoftpersonalcontent.com',
  'https://*.sharepoint.com',
];

export function contentSecurityPolicy(syncUrl: string, frameAncestors = "'none'"): string {
  const syncOrigin = new URL(syncUrl).origin;
  return [
    "default-src 'self'",
    `script-src 'self' 'wasm-unsafe-eval' ${BEACON_SCRIPT_ORIGIN}`,
    "style-src 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "worker-src 'self' blob:",
    `connect-src 'self' https://api.anthropic.com https://generativelanguage.googleapis.com ${syncOrigin} ${BEACON_REPORT_ORIGIN} ${MICROSOFT_LOGIN} ${ONEDRIVE_ORIGINS.join(' ')}`,
    // Silent renewal of the Microsoft sign-in (hidden frame).
    `frame-src ${MICROSOFT_LOGIN}`,
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    `frame-ancestors ${frameAncestors}`,
  ].join('; ');
}

export function headersFile(syncUrl: string): string {
  return `/*
  Content-Security-Policy: ${contentSecurityPolicy(syncUrl)}
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  X-Frame-Options: DENY
  Cross-Origin-Opener-Policy: same-origin
  Permissions-Policy: camera=(self), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()
  Strict-Transport-Security: max-age=31536000; includeSubDomains
${AUTH_REDIRECT_PATH}
  ! Content-Security-Policy
  ! X-Frame-Options
  Content-Security-Policy: ${contentSecurityPolicy(syncUrl, "'self'")}
`;
}
