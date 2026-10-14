import { useState } from 'react';
import { t } from '../../i18n/pt-PT';
import { useSession } from '../auth/session-context';
import { buildCalendarFile } from './calendar-export';
import '../ingest/ingest.css';

const copy = t.contracts.calendar;

function download(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/calendar;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Downloads the loyalty ends and payment due dates as an .ics file (PLAN.md §13, next actions). */
export function CalendarExport() {
  const { session } = useSession();
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);
  if (!session) return null;
  const { repos } = session;

  async function exportDates() {
    setBusy(true);
    setMessage(undefined);
    try {
      const file = await buildCalendarFile(repos, window.location.origin);
      if (!file) {
        setMessage(copy.empty);
        return;
      }
      download(file.ics, copy.fileName);
      setMessage(copy.exported(file.count));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="calendar-title">
      <h2 id="calendar-title" className="section-title">
        {copy.title}
      </h2>
      <p>{copy.intro}</p>
      <div className="ingest-actions">
        <button type="button" className="action-primary" disabled={busy} onClick={exportDates}>
          {copy.export}
        </button>
      </div>
      {message && (
        <p role="status" className="doc-saved">
          {message}
        </p>
      )}
      <p className="muted">{copy.note}</p>
    </section>
  );
}
