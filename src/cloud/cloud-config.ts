/**
 * Ids of the app with each cloud service (not secrets: they only name the app on
 * each sign-in page). Empty: the service is not offered.
 */

/**
 * The app's id in the Microsoft identity platform (an SPA registration, see
 * docs/onedrive.md). Not a secret: it only names the app on the sign-in page.
 * VITE_ONEDRIVE_CLIENT_ID overrides it at build time.
 * Without an id, OneDrive is not offered.
 */
export const PROJECT_ONEDRIVE_CLIENT_ID = '0af920e6-fd52-456f-9f4d-c1fc3d11f436';

/**
 * The app key in the Dropbox App Console (see docs/dropbox.md). Not a secret.
 * VITE_DROPBOX_APP_KEY overrides it at build time. Without it, Dropbox is not offered.
 */
export const PROJECT_DROPBOX_APP_KEY = '';

/**
 * The OAuth client id in Google Cloud (see docs/google-drive.md). Not a secret; the
 * client secret lives only in the sync server. VITE_GOOGLE_CLIENT_ID overrides it.
 * Without it, Google Drive is not offered.
 */
export const PROJECT_GOOGLE_CLIENT_ID = '';
