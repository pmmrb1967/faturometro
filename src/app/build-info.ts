/** Which build is running, set by vite.config.ts at build time (shown in Settings). */
declare const __APP_COMMIT__: string;
declare const __APP_BUILT__: string;

export const APP_COMMIT = __APP_COMMIT__;
/** ISO date (YYYY-MM-DD) of the build. */
export const APP_BUILT = __APP_BUILT__;
