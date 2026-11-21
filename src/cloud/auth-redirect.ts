/**
 * The page Microsoft sign-in comes back to (auth-redirect.html): hands the
 * answer to the app (the page that started the sign-in, or its hidden frame).
 */
import { broadcastResponseToMainFrame } from '@azure/msal-browser/redirect-bridge';

broadcastResponseToMainFrame().catch(() => {
  // Opened without an answer (e.g. reloaded): back to the app.
  if (window.top === window) window.location.replace('/app');
});
