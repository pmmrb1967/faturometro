import { isDemo } from '../db/profiles';
import { useSession } from '../features/auth/session-context';
import { t } from '../i18n/pt-PT';
import { useDemo } from './use-demo';

/** On every page of the demonstration: it is example data, and the way out. */
export function DemoBanner() {
  const { session } = useSession();
  const { leave, startOwn, busy } = useDemo();
  if (!session || !isDemo(session.profile)) return null;
  return (
    <div className="update-banner demo-banner" role="status">
      <span>{t.demo.banner}</span>
      <span className="demo-banner-actions">
        <button
          type="button"
          className="action-primary action-compact"
          disabled={busy}
          onClick={() => void startOwn()}
        >
          {t.demo.startOwn}
        </button>
        <button
          type="button"
          className="action-secondary action-compact"
          disabled={busy}
          onClick={() => void leave()}
          aria-label={t.demo.leaveLabel}
          title={t.demo.leaveLabel}
        >
          {t.demo.leave}
        </button>
      </span>
    </div>
  );
}

/** Above the import, in the demonstration: what is imported there does not stay. */
export function DemoImportNotice() {
  const { session } = useSession();
  if (!session || !isDemo(session.profile)) return null;
  return <p className="demo-import-notice">{t.demo.importNotice}</p>;
}

/** The account corner of the top bar, in the demonstration. */
export function DemoTopbarAccount() {
  const { leave, busy } = useDemo();
  return (
    <>
      <span className="topbar-badge">{t.demo.badge}</span>
      <button
        type="button"
        className="action-secondary action-compact"
        disabled={busy}
        onClick={() => void leave()}
        aria-label={t.demo.leaveLabel}
        title={t.demo.leaveLabel}
      >
        {t.signOut}
      </button>
    </>
  );
}
