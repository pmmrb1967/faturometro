import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { t } from '../../i18n/pt-PT';
import type { ParsedDocument } from '../ingest/ingest';
import type { PageText } from '../../pdf/text';
import type { FiscalQr } from '../../qr/parse';
import { useSession } from '../auth/session-context';
import { getSettings } from '../settings/settings';
import { ContributePanel } from './ContributePanel';
import { personalValues } from './eligible';

const copy = t.contribute;

/**
 * "Contribuir com este layout": the offer, then the preview. `parsed` is what a layout
 * parser read (it decides nothing here); `extra` adds other readings (e.g. by the AI)
 * whose identifiers must stay masked too.
 */
export function ContributeOffer({
  pages,
  qrs,
  parsed,
  extra = [],
  intro = true,
}: {
  pages: PageText[];
  qrs: FiscalQr[];
  parsed?: ParsedDocument;
  extra?: (ParsedDocument | undefined)[];
  /** Shows the explanation before the button (after an import). */
  intro?: boolean;
}) {
  const { session } = useSession();
  const settings = useLiveQuery(
    async () => (session ? getSettings(session.repos) : null),
    [session],
  );
  const [open, setOpen] = useState(false);
  if (!settings) return null;

  if (!open) {
    return (
      <div className="contribute-offer">
        {intro && <p className="muted">{copy.offer}</p>}
        <button type="button" className="text-button" onClick={() => setOpen(true)}>
          {copy.open}
        </button>
      </div>
    );
  }

  const personal = [parsed, ...extra].flatMap((reading) =>
    personalValues({
      qrs,
      ...(reading ? { extraction: reading.extraction } : {}),
      ...(settings.ownNif ? { ownNif: settings.ownNif } : {}),
      ...(session?.profile.email ? { email: session.profile.email } : {}),
    }),
  );
  return (
    <ContributePanel
      pages={pages}
      qrs={qrs}
      personal={[...new Set(personal)]}
      context={{
        pages: pages.length,
        ...(parsed
          ? {
              parserId: parsed.parserId,
              parserVersion: parsed.parserVersion,
              failures: parsed.check.failures,
            }
          : {}),
      }}
      onClose={() => setOpen(false)}
    />
  );
}
