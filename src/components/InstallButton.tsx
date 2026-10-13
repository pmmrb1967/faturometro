import { useState } from 'react';
import { promptInstall, useInstallState } from '../app/install';
import { t } from '../i18n/pt-PT';

const copy = t.install;

/** Install button (Chrome/Edge) or the steps for Safari; nothing once installed. */
export function InstallButton({ className = 'action-primary' }: { className?: string }) {
  const state = useInstallState();
  const [showSteps, setShowSteps] = useState(false);

  if (state.kind === 'installed') return <p className="muted install-done">{copy.installed}</p>;

  if (state.kind === 'prompt') {
    return (
      <button type="button" className={className} onClick={() => void promptInstall()}>
        {copy.button}
      </button>
    );
  }

  const steps = state.kind === 'ios' ? copy.iosSteps : copy.manualSteps;
  return (
    <div className="install-help">
      <button
        type="button"
        className={className}
        aria-expanded={showSteps}
        onClick={() => setShowSteps((open) => !open)}
      >
        {copy.button}
      </button>
      {showSteps && (
        <ol className="install-steps">
          {steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      )}
    </div>
  );
}
