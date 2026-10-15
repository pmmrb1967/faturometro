import { useLocation } from 'react-router';
import { feedbackLink, type FeedbackKind } from '../app/feedback';
import { t } from '../i18n/pt-PT';

const KINDS: FeedbackKind[] = ['suggestion', 'problem', 'parser'];

/** Links that open the user's email app with a prefilled message to the project. */
export function FeedbackLinks({ kinds = KINDS }: { kinds?: FeedbackKind[] }) {
  const { pathname } = useLocation();
  return (
    <div className="ingest-actions">
      {kinds.map((kind) => (
        <a
          key={kind}
          className="action-secondary feedback-link"
          href={feedbackLink(kind, pathname)}
        >
          {t.feedback.links[kind]}
        </a>
      ))}
    </div>
  );
}
