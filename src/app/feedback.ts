/**
 * Feedback by email: a mailto link that opens the user's own email app. The
 * app sends nothing; the "from" is whatever account that app uses. Subjects
 * start with "Faturómetro:" so they can be grouped on arrival.
 */
import { t } from '../i18n/pt-PT';
import { APP_BUILT, APP_COMMIT } from './build-info';

export const FEEDBACK_EMAIL = 'faturometro@outlook.com';

export type FeedbackKind = 'suggestion' | 'problem' | 'parser';

/** Technical lines that help with a report: version and page, never invoice data. */
export function feedbackBody(page: string, commit = APP_COMMIT, built = APP_BUILT): string {
  const copy = t.feedback;
  return [
    copy.bodyStart,
    '',
    '',
    copy.technical,
    copy.version(commit, built),
    copy.page(page),
  ].join('\n');
}

export function feedbackLink(kind: FeedbackKind | 'general', page: string): string {
  const subject = `Faturómetro: ${t.feedback.subjects[kind]}`;
  return `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(feedbackBody(page))}`;
}
