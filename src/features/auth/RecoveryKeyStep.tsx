import { useState } from 'react';
import { useHoldUpdates } from '../../app/pwa';
import { t } from '../../i18n/pt-PT';
import { AuthLayout } from './AuthLayout';

interface Props {
  email: string;
  recoveryKey: string;
  onDone: () => void;
}

export function RecoveryKeyStep({ email, recoveryKey, onDone }: Props) {
  // Shown once: a new version of the app must not reload it away.
  useHoldUpdates(true);
  const copy = t.auth.recoveryKey;
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copyKey() {
    await navigator.clipboard.writeText(recoveryKey);
    setCopied(true);
  }

  function download() {
    const text = `${copy.fileIntro}\n\n${t.auth.email}: ${email}\n${copy.title}: ${recoveryKey}\n`;
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = copy.fileName;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <AuthLayout title={copy.title} intro={copy.intro}>
      <p className="recovery-key" aria-label={copy.title}>
        {recoveryKey}
      </p>
      <div className="recovery-actions">
        <button type="button" className="auth-secondary" onClick={copyKey}>
          {copied ? copy.copied : copy.copy}
        </button>
        <button type="button" className="auth-secondary" onClick={download}>
          {copy.download}
        </button>
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={saved}
          onChange={(event) => setSaved(event.target.checked)}
        />
        {copy.confirm}
      </label>
      <button type="button" className="auth-submit" disabled={!saved} onClick={onDone}>
        {copy.continue}
      </button>
    </AuthLayout>
  );
}
