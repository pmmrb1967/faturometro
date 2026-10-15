import { Link, useLocation } from 'react-router';
import { feedbackLink } from '../app/feedback';
import { t } from '../i18n/pt-PT';

const REPO_URL = 'https://github.com/pmmrb1967/faturometro';
const LICENSE_URL = `${REPO_URL}/blob/main/LICENSE`;

/** Copyright and licence, at the bottom of every page. */
export function LegalFooter({ className = 'legal-footer' }: { className?: string }) {
  const { pathname } = useLocation();
  return (
    <footer className={className}>
      <p>{t.legal.copyright}</p>
      <Link to="/privacidade">{t.legal.privacy}</Link>
      <a href={feedbackLink('general', pathname)}>{t.feedback.footer}</a>
      <a href={LICENSE_URL} rel="noreferrer">
        {t.legal.license}
      </a>
      <a href={REPO_URL} rel="noreferrer">
        {t.legal.source}
      </a>
    </footer>
  );
}
