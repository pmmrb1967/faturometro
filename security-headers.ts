import { BEACON_REPORT_ORIGIN, BEACON_SCRIPT_ORIGIN } from './src/app/web-analytics-config.ts';

/**
 * Security headers of the published app (PLAN.md §11), written to
 * dist/_headers at build time; Cloudflare's static assets serve them.
 *
 * The app may only connect to itself, the Anthropic API (AI, with the
 * user's key), the sync server and Cloudflare Web Analytics (public pages
 * only, src/app/web-analytics.ts). 'wasm-unsafe-eval' lets the QR reader's
 * WebAssembly run; it does not allow eval() of JavaScript.
 */
export function contentSecurityPolicy(syncUrl: string): string {
  const syncOrigin = new URL(syncUrl).origin;
  return [
    "default-src 'self'",
    `script-src 'self' 'wasm-unsafe-eval' ${BEACON_SCRIPT_ORIGIN}`,
    "style-src 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "worker-src 'self' blob:",
    `connect-src 'self' https://api.anthropic.com ${syncOrigin} ${BEACON_REPORT_ORIGIN}`,
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
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
`;
}
