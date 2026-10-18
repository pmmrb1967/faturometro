import { useState } from 'react';
import { PRESCRIPTION_SOURCES } from '../../domain/prescription';
import type { Contract } from '../../domain/types';
import { t } from '../../i18n/pt-PT';
import { today } from '../alerts/refresh';
import { useSession } from '../auth/session-context';
import { buildLetter, letterKinds, loadLetterData, type LetterKind } from './letters';
import '../ingest/ingest.css';
import './letters.css';

const copy = t.contracts.letters;

/** Letter templates filled with the contract's data, without AI (CLAUDE.md rule 4). */
export function LettersSection({ contract }: { contract: Contract }) {
  const { session } = useSession();
  const [letter, setLetter] = useState<{ kind: LetterKind; subject: string; text: string }>();
  const [copied, setCopied] = useState(false);
  if (!session) return null;
  const { repos } = session;

  async function open(kind: LetterKind) {
    const data = await loadLetterData(repos, contract);
    setLetter({ kind, ...buildLetter(kind, data, today()) });
    setCopied(false);
  }

  async function copyText() {
    if (!letter) return;
    await navigator.clipboard.writeText(letter.text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  const mailto = letter
    ? `mailto:?subject=${encodeURIComponent(letter.subject)}&body=${encodeURIComponent(letter.text)}`
    : undefined;

  return (
    <section className="letters" aria-labelledby="letters-title">
      <h2 id="letters-title" className="section-title">
        {copy.title}
      </h2>
      <p className="muted">{copy.intro}</p>
      <div className="ingest-actions">
        {letterKinds(contract).map((kind) => (
          <button
            key={kind}
            type="button"
            className="action-secondary"
            aria-pressed={letter?.kind === kind}
            onClick={() => void open(kind)}
          >
            {copy.kinds[kind]}
          </button>
        ))}
      </div>
      {letter && (
        <div className="letter">
          <label htmlFor="letter-text">{copy.textLabel}</label>
          <textarea
            id="letter-text"
            rows={18}
            value={letter.text}
            onChange={(event) => setLetter({ ...letter, text: event.target.value })}
          />
          <p className="muted">{copy.placeholdersNote}</p>
          {letter.kind === 'prescription' && PRESCRIPTION_SOURCES[contract.sector] && (
            <p className="letter-warning">
              {copy.prescriptionNote}{' '}
              <a
                href={PRESCRIPTION_SOURCES[contract.sector]}
                target="_blank"
                rel="noopener noreferrer"
              >
                {contract.sector === 'telecom' ? copy.regulators.telecom : copy.regulators.energy}
              </a>
            </p>
          )}
          <div className="ingest-actions">
            <button type="button" className="action-primary" onClick={() => void copyText()}>
              {copied ? copy.copied : copy.copy}
            </button>
            <a className="action-secondary" href={mailto}>
              {copy.email}
            </a>
          </div>
          <p className="muted">
            {copy.complaint}{' '}
            <a href={copy.complaintUrl} target="_blank" rel="noopener noreferrer">
              {copy.complaintLink}
            </a>
          </p>
        </div>
      )}
    </section>
  );
}
