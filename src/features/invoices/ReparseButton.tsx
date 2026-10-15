import { useState } from 'react';
import type { Invoice } from '../../domain/types';
import { t } from '../../i18n/pt-PT';
import type { Parser } from '../../parsers/types';
import { useSession } from '../auth/session-context';
import { browserIngestDeps } from '../ingest/browser-deps';
import { reparseInvoice, type ReparseResult } from './reparse';

const copy = t.invoices.reparse;

/** "Ler de novo com o leitor da …": for invoices saved before their supplier had (this) reader. */
export function ReparseButton({ invoice, parser }: { invoice: Invoice; parser: Parser }) {
  const { session } = useSession();
  const [state, setState] = useState<'idle' | 'busy' | ReparseResult>('idle');
  if (!session) return null;
  const { repos } = session;

  async function run() {
    setState('busy');
    try {
      setState(await reparseInvoice(repos, invoice, browserIngestDeps(repos)));
    } catch {
      setState('unreadable');
    }
  }

  if (state === 'updated') {
    return (
      <p role="status" className="doc-saved reparse">
        {copy.done(parser.name)}
      </p>
    );
  }
  return (
    <span className="reparse">
      <button
        type="button"
        className="action-secondary"
        disabled={state === 'busy'}
        onClick={() => void run()}
      >
        {state === 'busy' ? copy.working : copy.button(parser.name)}
      </button>
      {state !== 'idle' && state !== 'busy' && (
        <span className="ingest-problem" role="alert">
          {copy.failed[state]}
        </span>
      )}
    </span>
  );
}
