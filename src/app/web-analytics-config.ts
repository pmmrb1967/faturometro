/**
 * Cloudflare Web Analytics settings. Shared by the app (web-analytics.ts) and
 * the build (security-headers.ts), which allows these origins.
 */

/** Public token of the site in Cloudflare Web Analytics (empty = off). Not a secret. */
export const WEB_ANALYTICS_TOKEN = '6214832c83824161b618775ca72a1b15';
export const BEACON_SCRIPT_ORIGIN = 'https://static.cloudflareinsights.com';
export const BEACON_REPORT_ORIGIN = 'https://cloudflareinsights.com';
